const { Logger } = require('./gas-compatibility'); // 혹은 console 객체로 대체
const axios = require('axios');
const cheerio = require('cheerio');

/**
 * 숫자의 쉼표를 제거하고 부동소수점 숫자로 변환합니다.
 */
function cleanAndParseNumber(value) {
     if (value === null || value === undefined) return null;
     if (typeof value === 'number') return value;
     const cleaned = String(value).trim().replace(/,/g, '');
     if (cleaned === '') return null;
     return parseFloat(cleaned);
}

/**
 * 날짜 문자열을 'NQYY' 형식(예: '2Q25')으로 변환합니다.
 */
function formatDateToQuarter(dateStr) {
     const parts = dateStr.split('/');
     const year = parts[0].slice(-2);
     const month = parseInt(parts[1], 10);
     const quarter = Math.ceil(month / 3);
     return `${quarter}Q${year}`;
}

/**
 * Daum 증권(WiseFn)에서 HTML 데이터를 파싱하여 분기별 실적을 '억원' 단위로 반환합니다.
 * getNaverQuarterlyEarnings와 동일한 입출력 형식을 가집니다.
 * @param {string} companyCode - 종목 코드 (예: '317850')
 * @param {string} statementType - 재무제표 유형 ('연결' 또는 '별도')
 * @returns {Promise<Array|null>} 분기별 실적 데이터 배열 또는 null
 */
async function getQuarterlyEarnings(companyCode, statementType) {
     if (!companyCode || !statementType) {
          Logger.log(
               '에러: 증권 코드와 재무제표 유형(연결/별도)을 모두 입력해야 합니다.'
          );
          return null;
     }

     // statementType에 따라 finGubun 값을 매핑
     const finGubun = statementType === '연결' ? 'IFRSL' : 'IFRSS';
     const url = `https://wisefn.finance.daum.net/v1/company/cF3001.aspx?cmp_cd=${companyCode}&frq=Q&rpt=ISM&finGubun=${finGubun}`;

     Logger.log(
          ` -> Daum 증권 데이터 조회 시도... [${companyCode}, ${statementType}]`
     );

     try {
          const response = await axios.get(url, {
               validateStatus: () => true,
          });

          if (response.status !== 200) {
               Logger.log(` -> 데이터 조회 실패. 응답코드: ${response.status}`);
               return null;
          }

          const html = response.data;
          const $ = cheerio.load(html);

          const quarterlyData = [];
          const keywords = {
               매출액: 'sales',
               영업이익: 'operatingProfit',
               순이익: 'netIncome', // Daum은 '당기순이익'이 아닌 '순이익'으로 표기
          };

          // HTML 내의 <area> 태그에 데이터가 포함되어 있음
          $('area').each((i, elem) => {
               const title = $(elem).attr('title');
               if (title) {
                    const lines = title.split('\n');
                    const itemLine = lines[0];
                    const dateLine = lines[1];
                    const valueLine = lines[2];

                    if (itemLine && dateLine && valueLine) {
                         const itemNameRaw = itemLine
                              .replace(/[\[\]]/g, '')
                              .trim();
                         const itemName = keywords[itemNameRaw];

                         if (itemName) {
                              const quarterStr = dateLine.split(':')[1]?.trim();
                              const valueStr = valueLine.split(':')[1]?.trim();

                              if (quarterStr && valueStr) {
                                   const parsedValue =
                                        cleanAndParseNumber(valueStr);

                                   if (parsedValue !== null) {
                                        quarterlyData.push({
                                             quarter: formatDateToQuarter(
                                                  quarterStr
                                             ),
                                             item: itemName,
                                             value: parsedValue,
                                        });
                                   }
                              }
                         }
                    }
               }
          });

          if (quarterlyData.length === 0) {
               Logger.log(' -> 유효한 재무 데이터를 찾을 수 없습니다.');
               return null;
          }

          Logger.log(
               ` -> 총 ${quarterlyData.length}개의 분기별 실적 데이터 추출 완료.`
          );
          return quarterlyData;
     } catch (e) {
          Logger.log(` -> Daum 증권 HTML 파싱 중 오류 발생: ${e.toString()}`);
          return null;
     }
}

// // 1. 연결 재무제표 조회
// getQuarterlyEarnings('317850', '연결').then((data) => {
//      console.log('\n--- [연결] 재무제표 결과 ---');
//      if (data) {
//           console.log(JSON.stringify(data, null, 2));
//      }
// });

// // 2. 별도 재무제표 조회 (만약 데이터가 있다면)
// getQuarterlyEarnings('317850', '별도').then((data) => {
//      console.log('\n--- [별도] 재무제표 결과 ---');
//      if (data) {
//           console.log(JSON.stringify(data, null, 2));
//      } else {
//           console.log('별도 재무 데이터를 가져올 수 없거나 데이터가 없습니다.');
//      }
// });

module.exports = {
     getQuarterlyEarnings,
};
