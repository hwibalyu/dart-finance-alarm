const { Logger, PropertiesService } = require('./gas-compatibility');
const axios = require('axios');
const FormData = require('form-data');

// =================================================================
// SECTION: 텍스트 및 숫자 포맷팅 헬퍼 함수
// =================================================================

function padNumber(num, width) {
     if (num === null || num === undefined) {
          return ' N/A'.padStart(width);
     }
     const numStr = num.toLocaleString('ko-KR', {
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
     });
     return numStr.padStart(width);
}
function formatNumberWithCommas(num) {
     if (num === null || num === undefined) return 'N/A';
     return num.toLocaleString('ko-KR', {
          minimumFractionDigits: 0,
          maximumFractionDigits: 1,
     });
}
function getUnitText(multiplier) {
     if (multiplier === 1000) return '천원';
     if (multiplier === 1000000) return '백만원';
     if (multiplier === 100000000) return '억원';
     if (multiplier > 1000 && multiplier < 2000) return 'USD';
     if (multiplier > 150 && multiplier < 250) return 'CNY';
     if (multiplier > 5 && multiplier < 15) return 'JPY';
     return '원';
}
function formatEarningsWithConsensus(
     label,
     actual,
     consensus,
     importanceText = ''
) {
     let output = `*${label}:* ${formatNumberWithCommas(actual)}`;
     if (consensus !== null && consensus !== undefined && consensus !== 0) {
          const achievementRate =
               consensus > 0
                    ? ((actual / consensus - 1) * 100).toFixed(0) + '%'
                    : '-';
          output += ` (${formatNumberWithCommas(
               consensus
          )}, ${achievementRate})`;
     }
     output += importanceText;
     return output;
}

// =================================================================
// SECTION: 중요도 계산 함수
// =================================================================

/**
 * Legacy Code 기반의 실적 중요도 점수 계산 함수
 * @param {Array} quarterlyEarnings - 5분기 실적 데이터 배열
 * @param {Object} consensus - 컨센서스 데이터 객체
 * @returns {Object} - { sales: 점수, operatingProfit: 점수, netIncome: 점수 }
 */
function calculateImportanceScore(quarterlyEarnings, consensus) {
     if (!quarterlyEarnings || quarterlyEarnings.length === 0) {
          return { sales: 0, operatingProfit: 0, netIncome: 0 };
     }

     // 1. 데이터 구조화
     const structuredData = {
          sales: { actual: null, forecast: null, yoy: null, qoq: null },
          operatingProfit: {
               actual: null,
               forecast: null,
               yoy: null,
               qoq: null,
          },
          netIncome: { actual: null, forecast: null, yoy: null, qoq: null },
     };

     const latestQuarterStr = quarterlyEarnings[0].quarter;
     const [latestQ, latestY] = latestQuarterStr.split('Q').map(Number);

     const qoqY = latestQ === 1 ? latestY - 1 : latestY;
     const qoqQ = latestQ === 1 ? 4 : latestQ - 1;
     const qoqQuarterStr = `${qoqQ}Q${qoqY}`;
     const yoyQuarterStr = `${latestQ}Q${latestY - 1}`;

     // quarterlyEarnings 배열을 순회하며 데이터 채우기
     for (const earning of quarterlyEarnings) {
          // ★★★ [수정] structuredData에 해당 item 키가 존재하는지 먼저 확인 ★★★
          if (structuredData[earning.item]) {
               if (earning.quarter === latestQuarterStr) {
                    structuredData[earning.item].actual = earning.value;
               } else if (earning.quarter === qoqQuarterStr) {
                    structuredData[earning.item].qoq = earning.value;
               } else if (earning.quarter === yoyQuarterStr) {
                    structuredData[earning.item].yoy = earning.value;
               }
          }
     }

     // 컨센서스 데이터 채우기
     if (consensus) {
          structuredData.sales.forecast = consensus.sales;
          structuredData.operatingProfit.forecast = consensus.operatingProfit;
          structuredData.netIncome.forecast = consensus.netIncome;
     }

     // 2. 중요도 점수 계산 (Legacy Code 로직)
     const importance = { sales: 0, operatingProfit: 0, netIncome: 0 };
     const factors = ['forecast', 'yoy', 'qoq'];

     for (const key of ['sales', 'operatingProfit', 'netIncome']) {
          let totalScore = 0;
          const { actual } = structuredData[key];

          if (actual === null || actual === undefined) continue;

          for (const factor of factors) {
               const vs = structuredData[key][factor];

               if (factor === 'forecast' && (vs === null || vs === 0)) {
                    continue;
               }
               if (vs === null || vs === undefined) continue;

               let scoreForFactor = 0;

               if (actual > 0 && vs > 0) {
                    const growth = ((actual - vs) / vs) * 100;
                    if (growth >= 0) {
                         const clampedGrowth = Math.min(growth, 100);
                         scoreForFactor =
                              clampedGrowth *
                              (factor === 'forecast' ? 1.65 : 1.5);
                         if (key === 'operatingProfit') {
                              if (actual > 500) scoreForFactor *= 1.35;
                              else if (actual > 250) scoreForFactor *= 1.3;
                              else if (actual > 100) scoreForFactor *= 1.2;
                         }
                    } else {
                         const clampedGrowth = Math.max(growth, -50);
                         scoreForFactor = clampedGrowth * 1.5;
                    }
               } else if (actual > 0 && vs <= 0) {
                    scoreForFactor = 100;
               } else if (actual <= 0 && vs > 0) {
                    scoreForFactor = -65;
               } else if (actual <= 0 && vs <= 0) {
                    if (actual > vs) {
                         scoreForFactor = 40;
                    } else {
                         scoreForFactor = -20;
                    }
               }

               totalScore += scoreForFactor;
          }

          let finalImportance = 0;
          if (totalScore >= 300) finalImportance = 6;
          else if (totalScore >= 200) finalImportance = 5;
          else if (totalScore >= 150) finalImportance = 4;
          else if (totalScore >= 100) finalImportance = 3;
          else if (totalScore >= 40) finalImportance = 2;
          else if (totalScore >= 20) finalImportance = 1;

          if (actual < 0) finalImportance = 0;
          importance[key] = finalImportance;
     }

     return importance;
}

// =================================================================
// SECTION: 텔레그램 메시지 생성 및 전송 함수
// =================================================================

function createTelegramCaption(result) {
     let caption = `🏢 *${result.corp_name} (${result.stock_code})*\n`;
     caption += `[${result.report_nm.trim()}](${`https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${result.rcept_no}`})\n\n`;

     if (result.quarterlyEarnings && result.quarterlyEarnings.length > 0) {
          const earningsByQuarter = result.quarterlyEarnings.reduce(
               (acc, curr) => {
                    if (!acc[curr.quarter]) acc[curr.quarter] = {};
                    acc[curr.quarter][curr.item] = curr.value;
                    return acc;
               },
               {}
          );

          const latestQuarter = result.quarterlyEarnings[0].quarter;
          const latestEarnings = earningsByQuarter[latestQuarter];
          const consensus = result.consensus;
          const scores = result.importanceScores || {
               sales: 0,
               operatingProfit: 0,
               netIncome: 0,
          };
          const icons = { 5: '🔥', 6: '🚨' };

          // 중요도가 0 이하인 경우 빈 문자열 반환
          const getImportanceText = (score) => {
               if (score <= 0) return '';
               const icon = icons[score] || '';
               return `  ${icon}중요${score}`;
          };

          if (latestEarnings) {
               caption +=
                    formatEarningsWithConsensus(
                         '매',
                         latestEarnings.sales,
                         consensus ? consensus.sales : null,
                         getImportanceText(scores.sales)
                    ) + '\n';
               caption +=
                    formatEarningsWithConsensus(
                         '영',
                         latestEarnings.operatingProfit,
                         consensus ? consensus.operatingProfit : null,
                         getImportanceText(scores.operatingProfit)
                    ) + '\n';
               caption +=
                    formatEarningsWithConsensus(
                         '순',
                         latestEarnings.netIncome,
                         consensus ? consensus.netIncome : null,
                         getImportanceText(scores.netIncome)
                    ) + '\n\n';
          }

          caption += '------------------------------------\n';
          caption += '`[분기]` `매출` `영업` `순익` (억원)\n';

          for (const quarter in earningsByQuarter) {
               const qEarnings = earningsByQuarter[quarter];
               const sales = padNumber(qEarnings.sales, 7);
               const op = padNumber(qEarnings.operatingProfit, 7);
               const ni = padNumber(qEarnings.netIncome, 7);
               caption += `*[${quarter}]* ${sales} ${op} ${ni}\n`;
          }
          caption += '------------------------------------';
     } else {
          caption += `❌ 실적 추출/통합 실패 또는 데이터 없음\n`;
          if (result.error) caption += ` (사유: ${result.error})`;
     }
     return caption;
}

/**
 * 텔레그램으로 텍스트 메시지를 보냅니다.
 */
async function sendTelegramMessage(text) {
     const TELEGRAM_BOT_TOKEN =
          PropertiesService.getScriptProperties().getProperty(
               'TELEGRAM_BOT_TOKEN'
          );
     const TELEGRAM_CHAT_ID =
          PropertiesService.getScriptProperties().getProperty(
               'TELEGRAM_CHAT_ID'
          );

     if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
          Logger.log('텔레그램 봇 토큰 또는 채팅 ID가 설정되지 않았습니다.');
          return;
     }

     const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
     const payload = {
          chat_id: TELEGRAM_CHAT_ID,
          text: text,
          parse_mode: 'Markdown',
          disable_web_page_preview: true,
     };

     try {
          await axios.post(url, payload, {
               headers: { 'Content-Type': 'application/json' },
          });
     } catch (e) {
          const errorInfo = e.response
               ? JSON.stringify(e.response.data)
               : e.message;
          Logger.log(`텔레그램 메시지 전송 실패: ${errorInfo}`);
     }
}

/**
 * 텔레그램으로 여러 장의 사진(미디어 그룹)과 캡션을 보냅니다.
 */
async function sendTelegramMediaGroup(blobs, caption) {
     const TELEGRAM_BOT_TOKEN =
          PropertiesService.getScriptProperties().getProperty(
               'TELEGRAM_BOT_TOKEN'
          );
     const TELEGRAM_CHAT_ID =
          PropertiesService.getScriptProperties().getProperty(
               'TELEGRAM_CHAT_ID'
          );

     if (
          !TELEGRAM_BOT_TOKEN ||
          !TELEGRAM_CHAT_ID ||
          !blobs ||
          blobs.length === 0
     ) {
          Logger.log('텔레그램 정보가 없거나 전송할 미디어가 없습니다.');
          return;
     }

     const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMediaGroup`;

     const formData = new FormData();
     formData.append('chat_id', TELEGRAM_CHAT_ID);

     const media = blobs.map((blob, index) => {
          const attachName = `photo${index}.png`;
          const mediaObject = {
               type: 'photo',
               media: `attach://${attachName}`,
          };
          if (index === 0) {
               mediaObject.caption = caption;
               mediaObject.parse_mode = 'Markdown';
          }
          formData.append(attachName, blob._buffer || blob, {
               filename: attachName,
          });
          return mediaObject;
     });

     formData.append('media', JSON.stringify(media));

     try {
          await axios.post(url, formData, {
               headers: formData.getHeaders(),
          });
     } catch (e) {
          const errorInfo = e.response
               ? JSON.stringify(e.response.data)
               : e.message;
          Logger.log(`텔레그램 미디어 그룹 전송 실패: ${errorInfo}`);
     }
}

module.exports = {
     padNumber,
     formatNumberWithCommas,
     getUnitText,
     createTelegramCaption,
     sendTelegramMessage,
     sendTelegramMediaGroup,
     calculateImportanceScore,
};
