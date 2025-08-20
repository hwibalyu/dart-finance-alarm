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
 */
async function getQuarterlyEarnings(companyCode, statementType) {
     if (!companyCode || !statementType) {
          Logger.log(
               '에러: 증권 코드와 재무제표 유형(연결/별도)을 모두 입력해야 합니다.'
          );
          return null;
     }

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
               순이익: 'netIncome',
          };

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

/**
 * [수정] 네이버 증권에서 시가총액을 조회하는 함수 (단위: 억원)
 * @param {string} stockCode - 종목 코드 (예: '000660')
 * @returns {Promise<number|null>} - 시가총액(억원 단위) 또는 실패 시 null
 */
async function getMarketCap(stockCode) {
     if (!stockCode) {
          Logger.log('에러: 종목 코드를 입력해야 합니다.');
          return null;
     }
     const url = `https://navercomp.wisereport.co.kr/v2/company/c1010001.aspx?cmp_cd=${stockCode}&cn=`;
     Logger.log(` -> 시가총액 조회 시도... [${stockCode}]`);

     try {
          const response = await axios.get(url, {
               headers: {
                    'User-Agent':
                         'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
               },
          });

          if (response.status !== 200) {
               Logger.log(
                    ` -> 시가총액 페이지 조회 실패. 응답코드: ${response.status}`
               );
               return null;
          }

          const $ = cheerio.load(response.data);

          const marketCapText = $('th.txt:contains("시가총액")')
               .next('td.num')
               .text()
               .trim();

          if (!marketCapText) {
               Logger.log(` -> 페이지에서 시가총액 정보를 찾지 못했습니다.`);
               return null;
          }

          // ★★★ [수정] 바로 텍스트를 숫자로 변환하는 간결한 로직 ★★★
          const cleanedText = marketCapText
               .replace(/,/g, '')
               .replace('억원', '');
          const marketCapInEok = parseInt(cleanedText, 10);

          if (!isNaN(marketCapInEok)) {
               Logger.log(
                    ` -> 시가총액 추출 성공: ${marketCapText} -> ${marketCapInEok.toLocaleString()}억원`
               );
               return marketCapInEok;
          } else {
               Logger.log(` -> 시가총액 숫자 변환 실패: "${marketCapText}"`);
               return null;
          }
     } catch (e) {
          Logger.log(` -> 시가총액 조회 중 오류 발생: ${e.message}`);
          return null;
     }
}

// =================================================================
// SECTION: 테스트용 코드
// =================================================================

async function testGetMarketCap() {
     Logger.log('--- 시가총액 조회 함수 테스트 시작 (단위: 억원) ---');
     const skHynix = await getMarketCap('000660');
     console.log(`SK하이닉스 시가총액: ${skHynix} 억원`);

     const samsungElec = await getMarketCap('005930');
     console.log(`삼성전자 시가총액: ${samsungElec} 억원`);

     const posco = await getMarketCap('005490');
     console.log(`포스코홀딩스 시가총액: ${posco} 억원`);
     Logger.log('--- 시가총액 조회 함수 테스트 종료 ---');
}

// (async () => {
//      await testGetMarketCap();
// })();

module.exports = {
     getQuarterlyEarnings,
     getMarketCap,
};
