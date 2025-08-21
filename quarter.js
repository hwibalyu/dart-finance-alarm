const { Logger } = require('./gas-compatibility');

/**
 * ★★★ [수정 완료] DART 최신 실적과 네이버 과거 실적을 결합하여 최종 5분기 데이터를 계산합니다. ★★★
 * 이제 이 함수는 데이터가 완전하다고 보장된 경우에만 호출됩니다.
 */
function calculate5QuarterEarnings(dartData, naverEarnings) {
     // 1. DART 공시 실적을 표준 형식으로 변환
     const dartQuarterlyData = [];
     const formattedDartQuarter = dartData.quarter
          ? dartData.quarter.replace(/(\d{2})년(\d{1,2})분기/, '$2Q$1')
          : null;

     if (formattedDartQuarter) {
          for (const [key, value] of Object.entries(dartData.earnings)) {
               if (value !== null) {
                    dartQuarterlyData.push({
                         quarter: formattedDartQuarter,
                         item: key,
                         value: value,
                    });
               }
          }
     }

     // 2. DART 공시 분기보다 최신인 네이버 데이터를 필터링
     const [dartQ, dartY] = formattedDartQuarter
          ? formattedDartQuarter.split('Q').map(Number)
          : [0, 0];
     const filteredNaverEarnings = naverEarnings.filter((d) => {
          const [nq, ny] = d.quarter.split('Q').map(Number);
          if (ny > dartY) return false;
          if (ny === dartY && nq >= dartQ) return false;
          return true;
     });

     // 3. 필터링된 네이버 실적과 DART 실적 데이터를 결합하고 중복 제거
     let combinedData = [...filteredNaverEarnings, ...dartQuarterlyData];
     const uniqueQuarters = {};
     combinedData = combinedData.filter((entry) => {
          const key = `${entry.quarter}-${entry.item}`;
          if (uniqueQuarters[key]) return false;
          uniqueQuarters[key] = true;
          return true;
     });

     // 4. isAnnual 플래그가 true일 때만 연간 실적을 4분기 실적으로 변환
     if (dartData.isAnnual && formattedDartQuarter) {
          const year = formattedDartQuarter.slice(2);

          const sumOfQuarters = {};
          combinedData.forEach((d) => {
               if (
                    (d.quarter === `1Q${year}` ||
                         d.quarter === `2Q${year}` ||
                         d.quarter === `3Q${year}`) &&
                    d.item in dartData.earnings
               ) {
                    if (!sumOfQuarters[d.item]) sumOfQuarters[d.item] = 0;
                    sumOfQuarters[d.item] += d.value;
               }
          });

          combinedData.forEach((d) => {
               if (
                    d.quarter === formattedDartQuarter &&
                    sumOfQuarters[d.item] !== undefined
               ) {
                    const originalValue = d.value;
                    d.value -= sumOfQuarters[d.item];
                    // Logger.log(
                    //      ` -> 4분기 실적 변환: [${
                    //           d.item
                    //      }] ${originalValue.toFixed(3)} - ${sumOfQuarters[
                    //           d.item
                    //      ].toFixed(3)} = ${d.value.toFixed(3)} (억원)`
                    // );
               }
          });
     }

     // 5. 분기별로 정렬하고 최신 5개 분기만 선택
     const sortedData = combinedData.sort((a, b) => {
          const [aq, ay] = a.quarter.split('Q').map(Number);
          const [bq, by] = b.quarter.split('Q').map(Number);
          if (ay !== by) return by - ay;
          return bq - aq;
     });

     const recentQuarters = [
          ...new Set(sortedData.map((d) => d.quarter)),
     ].slice(0, 5);
     const final5QuartersData = sortedData.filter((d) =>
          recentQuarters.includes(d.quarter)
     );

     return final5QuartersData;
}

module.exports = {
     calculate5QuarterEarnings,
};
