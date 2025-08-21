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
     let output = `*${label}:* ${formatNumberWithCommas(actual)}억 `;
     if (consensus !== null && consensus !== undefined && consensus !== 0) {
          let achievementRate = 0;
          if (consensus > 0) {
               achievementRate = (actual > consensus) - 1;
               achievementRate =
                    achievementRate > 0
                         ? `🔺 ${achievementRate.toFixed(0)}%`
                         : achievementRate < 0
                         ? `▼ ${Math.abs(achievementRate.toFixed(0))}%`
                         : `${achievementRate.toFixed(0)}%`;
          } else {
               achievementRate = '-';
          }

          output += ` (${formatNumberWithCommas(
               consensus
          )}억, ${achievementRate}) `;
     }
     output += importanceText;
     return output;
}

// =================================================================
// SECTION: 중요도 계산 함수
// =================================================================

function calculateImportanceScore(quarterlyEarnings, consensus) {
     if (!quarterlyEarnings || quarterlyEarnings.length === 0) {
          return { sales: 0, operatingProfit: 0, netIncome: 0 };
     }

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

     for (const earning of quarterlyEarnings) {
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

     if (consensus) {
          structuredData.sales.forecast = consensus.sales;
          structuredData.operatingProfit.forecast = consensus.operatingProfit;
          structuredData.netIncome.forecast = consensus.netIncome;
     }

     const importance = { sales: 0, operatingProfit: 0, netIncome: 0 };
     const factors = ['forecast', 'yoy', 'qoq'];

     // ★★★ [수정] 'netIncome'을 분석 대상에서 제외 ★★★
     for (const key of ['sales', 'operatingProfit']) {
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

/**
 * ★★★ [수정] 텔레그램 캡션 생성 함수 (시가총액, PER/POR 추가) ★★★
 */
function createTelegramCaption(result) {
     // 1. 헤더 생성 (시가총액 포함)
     let caption = `🏢 *${result.corp_name}`;
     if (result.marketCap) {
          caption += ` (${result.marketCap.toLocaleString('ko-KR')}억)`;
     }
     caption += `*\n[${result.report_nm.trim()}](${`https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${result.rcept_no}`})\n\n`;

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

          const getImportanceText = (score) => {
               if (score <= 0) return '';
               const icon = icons[score] || '';
               return `  ${icon}중요${score}`;
          };

          // 2. 최신 실적 요약 생성
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
                    ) + '\n';
          }

          // 3. PER/POR 지표 계산 및 추가
          const marketCap = result.marketCap;
          if (marketCap) {
               let metricsCaption = '\n';
               const uniqueQuarters = [
                    ...new Set(result.quarterlyEarnings.map((d) => d.quarter)),
               ];
               const hasFourQuarters = uniqueQuarters.length >= 4;

               // 연간 지표 계산
               let lastFourQuartersOpSum = 0;
               let lastFourQuartersNetSum = 0;
               if (hasFourQuarters) {
                    const fourQuarters = uniqueQuarters.slice(0, 4);
                    for (const q of fourQuarters) {
                         lastFourQuartersOpSum +=
                              earningsByQuarter[q]?.operatingProfit || 0;
                         lastFourQuartersNetSum +=
                              earningsByQuarter[q]?.netIncome || 0;
                    }
               }

               const annualPER =
                    hasFourQuarters && lastFourQuartersNetSum > 0
                         ? (marketCap / lastFourQuartersNetSum).toFixed(1)
                         : '-';
               const annualPOR =
                    hasFourQuarters && lastFourQuartersOpSum > 0
                         ? (marketCap / lastFourQuartersOpSum).toFixed(1)
                         : '-';

               // 분기 지표 계산
               const quarterPER =
                    latestEarnings.netIncome > 0
                         ? (marketCap / (latestEarnings.netIncome * 4)).toFixed(
                                1
                           )
                         : '-';
               const quarterPOR =
                    latestEarnings.operatingProfit > 0
                         ? (
                                marketCap /
                                (latestEarnings.operatingProfit * 4)
                           ).toFixed(1)
                         : '-';

               metricsCaption += `✦ 연간PER : ${annualPER}\n`;
               metricsCaption += `✦ 분기PER : ${quarterPER}\n`;
               metricsCaption += `✦ 연간POR : ${annualPOR}\n`;
               metricsCaption += `✦ 분기POR : ${quarterPOR}\n`;

               caption += metricsCaption;
          }

          // 4. 과거 실적 테이블 생성
          caption += '\n------------------------------------\n';
          // caption += '`[분기]` `매출` `영업` `순익` (억원)\n';

          for (const quarter in earningsByQuarter) {
               const qEarnings = earningsByQuarter[quarter];
               const sales = padNumber(qEarnings.sales, 7);
               const op = padNumber(qEarnings.operatingProfit, 7);
               const ni = padNumber(qEarnings.netIncome, 7);
               caption += `*[${quarter}]* ${sales}억 ${op}억 ${ni}억\n`;
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
