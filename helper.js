const { Logger, PropertiesService } = require('./gas-compatibility');
const axios = require('axios');
const FormData = require('form-data');

// =================================================================
// SECTION: 텍스트 및 숫자 포맷팅 헬퍼 함수
// (이 부분은 변경 사항이 없습니다)
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
function formatEarningsWithConsensus(label, actual, consensus) {
     let output = `*${label}:* ${formatNumberWithCommas(actual)}`;
     if (consensus !== null && consensus !== undefined && consensus !== 0) {
          const achievementRate =
               consensus > 0
                    ? ((actual / consensus - 1) * 100).toFixed(0) + '%'
                    : '-';
          output += `${consensus ? '  (' : ''} ${formatNumberWithCommas(
               consensus
          )}, ${achievementRate} ${consensus ? ')' : ''}`;
     }
     return output;
}

// =================================================================
// SECTION: 텔레그램 메시지 생성 및 전송 함수
// (이 부분 코드를 axios를 사용하도록 변경합니다)
// =================================================================

function createTelegramCaption(result) {
     // (이 함수는 네트워크 요청이 없으므로 변경 사항 없음)
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

          if (latestEarnings) {
               caption +=
                    formatEarningsWithConsensus(
                         '매',
                         latestEarnings.sales,
                         consensus ? consensus.sales : null
                    ) + '\n';
               caption +=
                    formatEarningsWithConsensus(
                         '영',
                         latestEarnings.operatingProfit,
                         consensus ? consensus.operatingProfit : null
                    ) + '\n';
               caption +=
                    formatEarningsWithConsensus(
                         '순',
                         latestEarnings.netIncome,
                         consensus ? consensus.netIncome : null
                    ) + '\n\n';
          }

          caption += '------------------------------------\n';

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
          // ============ [변경점] ============
          // UrlFetchApp.fetch -> axios.post
          // JSON payload는 axios가 자동으로 직렬화해줍니다.
          await axios.post(url, payload, {
               headers: { 'Content-Type': 'application/json' },
          });
          // =================================
     } catch (e) {
          // axios 에러는 e.response.data에 더 상세한 정보가 있을 수 있습니다.
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

     // ============ [변경점 시작] ============
     // 1. FormData 객체 생성은 동일합니다.
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
          // blob._buffer는 호환성 레이어에서 온 Buffer 객체입니다.
          formData.append(attachName, blob._buffer || blob, {
               filename: attachName,
          });
          return mediaObject;
     });

     formData.append('media', JSON.stringify(media));

     try {
          // 2. axios.post로 FormData를 전송합니다.
          //    이때, 헤더는 form-data 라이브러리가 자동으로 생성하도록 맡깁니다.
          await axios.post(url, formData, {
               headers: formData.getHeaders(),
          });
     } catch (e) {
          const errorInfo = e.response
               ? JSON.stringify(e.response.data)
               : e.message;
          Logger.log(`텔레그램 미디어 그룹 전송 실패: ${errorInfo}`);
     }
     // ============ [변경점 끝] ============
}

module.exports = {
     padNumber,
     formatNumberWithCommas,
     getUnitText,
     createTelegramCaption,
     sendTelegramMessage,
     sendTelegramMediaGroup,
};
