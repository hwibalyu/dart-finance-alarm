const { Logger } = require('./gas-compatibility');
const axios = require('axios');

/**
 * 숫자의 쉼표를 제거하고 부동소수점 숫자로 변환합니다.
 */
function cleanAndParseNaverNumber(value) {
     if (value === null || value === undefined) return null;
     if (typeof value === 'number') return value;
     const cleaned = String(value).trim().replace(/,/g, '');
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
 * 네이버 증권(WiseReport)에서 JSON 데이터를 파싱하여 '억원' 단위 그대로 반환합니다.
 */
async function getNaverQuarterlyEarnings(companyCode, statementType) {
     if (!companyCode || !statementType) {
          Logger.log(
               '에러: 증권 코드와 재무제표 유형(연결/별도)을 모두 입력해야 합니다.'
          );
          return null;
     }

     const finGubun = statementType === '연결' ? 'IFRSL' : 'IFRSS';
     const url = `https://navercomp.wisereport.co.kr/company/chart/c1030001.aspx?cmp_cd=${companyCode}&frq=Q&rpt=ISM&finGubun=${finGubun}&chartType=svg`;

     Logger.log(
          ` -> 네이버 증권 데이터 조회 시도... [${companyCode}, ${statementType}]`
     );

     try {
          const response = await axios.get(url, {
               validateStatus: () => true,
          });
          if (response.status !== 200) {
               Logger.log(` -> 데이터 조회 실패. 응답코드: ${response.status}`);
               return null;
          }

          const jsonData = response.data;
          if (
               !jsonData ||
               !jsonData.chartData1 ||
               !jsonData.chartData1.series
          ) {
               Logger.log(' -> 유효한 JSON 데이터를 찾을 수 없습니다.');
               return null;
          }

          const series = jsonData.chartData1.series;
          const categories = jsonData.chartData1.categories;
          const quarterlyData = [];

          const keywords = {
               매출액: 'sales',
               영업이익: 'operatingProfit',
               당기순이익: 'netIncome',
          };

          series.forEach((item) => {
               const itemNameRaw = item.name.replace('(좌)', '').trim();
               const itemName = keywords[itemNameRaw];

               if (itemName && item.data && item.data.length > 0) {
                    item.data.forEach((value, index) => {
                         if (value !== null && index < categories.length) {
                              const parsedValue =
                                   cleanAndParseNaverNumber(value);

                              if (
                                   parsedValue !== null &&
                                   item.unit === '억원'
                              ) {
                                   quarterlyData.push({
                                        quarter: formatDateToQuarter(
                                             categories[index]
                                        ),
                                        item: itemName,
                                        value: parsedValue,
                                   });
                              }
                         }
                    });
               }
          });

          Logger.log(
               ` -> 총 ${quarterlyData.length}개의 분기별 실적 데이터 추출 완료.`
          );
          return quarterlyData.length > 0 ? quarterlyData : null;
     } catch (e) {
          Logger.log(` -> 네이버 증권 JSON 파싱 중 오류 발생: ${e.toString()}`);
          return null;
     }
}

/**
 * getNaverQuarterlyEarnings 함수의 작동을 테스트합니다.
 */
async function testNaverEarnings(companyCode) {
     Logger.log('--- 네이버 증권 분기 실적 조회 테스트 시작 ---');

     // const companyCode = '009160';

     Logger.log(`\n[테스트 1] 대상: ${companyCode} (연결 재무제표)`);
     const consolidatedEarnings = await getNaverQuarterlyEarnings(
          companyCode,
          '연결'
     );

     if (consolidatedEarnings) {
          Logger.log('--- ✅ 연결 실적 추출 성공 ---');
          Logger.log(JSON.stringify(consolidatedEarnings, null, 2));
     } else {
          Logger.log('--- ❌ 연결 실적 추출 실패 ---');
     }

     Logger.log('\n--- 네이버 증권 테스트 종료 ---');
}

module.exports = {
     getNaverQuarterlyEarnings,
     testNaverEarnings,
};

// test 용
(async () => {
     await testNaverEarnings('302550');
})();
