// consensus.js 파일 상단에 이 두 줄을 추가하거나 확인하세요.
const axios = require('axios');
const { Logger } = require('./gas-compatibility');

// yymm 형식을 분기로 변환하는 함수는 그대로 둡니다.
function convertYymmToQuarter(yymmStr) {
     if (!yymmStr) return null;
     const parts = yymmStr.split('.');
     if (parts.length < 2) return null;

     const year = parts[0].slice(-2);
     const month = parseInt(parts[1], 10);
     const quarter = Math.ceil(month / 3);
     return `${quarter}Q${year}`;
}

// 기존 getNaverConsensus 함수를 아래 코드로 교체합니다.
async function getNaverConsensus(companyCode, statementType, quarter) {
     if (!companyCode || !statementType || !quarter) {
          Logger.log(
               '에러: 증권 코드, 재무제표 유형, 분기 정보를 모두 입력해야 합니다.'
          );
          return null;
     }

     const finGubun = statementType === '연결' ? 'IFRSL' : 'IFRSS';
     const today = new Date();
     const sDT = `${today.getFullYear()}${('0' + (today.getMonth() + 1)).slice(
          -2
     )}${('0' + today.getDate()).slice(-2)}`;
     const url = `https://navercomp.wisereport.co.kr/company/ajax/c1050001_data.aspx?flag=2&cmp_cd=${companyCode}&finGubun=${finGubun}&frq=1&sDT=${sDT}&chartType=svg`;

     Logger.log(
          ` -> 네이버 컨센서스 조회 시도... [${companyCode}, ${statementType}, ${quarter}]`
     );

     try {
          // ============ [변경점 시작] ============
          const response = await axios.get(url, {
               validateStatus: () => true,
          });

          if (response.status !== 200) {
               Logger.log(
                    ` -> 컨센서스 데이터 조회 실패. 응답코드: ${response.status}`
               );
               return null;
          }

          // axios가 자동으로 JSON을 파싱해줍니다.
          const jsonData = response.data;
          // ============ [변경점 끝] ============

          if (!jsonData || !jsonData.JsonData) {
               Logger.log(
                    ' -> 유효한 컨센서스 JSON 데이터를 찾을 수 없습니다.'
               );
               return null;
          }

          const targetData = jsonData.JsonData.find((d) => {
               const entryQuarter = convertYymmToQuarter(d.YYMM);
               return entryQuarter === quarter;
          });

          if (targetData) {
               // Logger.log(
               //      ` -> ${quarter} 컨센서스 데이터 찾음: ${JSON.stringify(
               //           targetData
               //      )}`
               // );
               return {
                    sales:
                         parseFloat(targetData.SALES.replace(/,/g, '')) || null,
                    operatingProfit:
                         parseFloat(targetData.OP.replace(/,/g, '')) || null,
                    netIncome:
                         parseFloat(targetData.NP.replace(/,/g, '')) || null,
               };
          } else {
               Logger.log(
                    ` -> ${quarter}에 해당하는 컨센서스 데이터를 찾지 못했습니다.`
               );
               return null;
          }
     } catch (e) {
          // 네트워크 오류 등 axios 요청 자체의 실패를 처리합니다.
          Logger.log(` -> 네이버 컨센서스 파싱 중 오류 발생: ${e.toString()}`);
          return null;
     }
}

// 테스트 함수는 그대로 둡니다.
async function test_getNaverConsensus() {
     Logger.log('--- 네이버 증권 컨센서스 조회 테스트 시작 ---');
     const companyCode = '207940';
     const statementType = '연결';
     const quarter = '2Q25';
     const consensus = await getNaverConsensus(
          companyCode,
          statementType,
          quarter
     );
     if (consensus) {
          Logger.log('\n--- ✅ 컨센서스 추출 성공 ---');
          Logger.log(JSON.stringify(consensus, null, 2));
     } else {
          Logger.log('\n--- ❌ 컨센서스 추출 실패 ---');
     }
}

// module.exports도 그대로 둡니다.
module.exports = {
     getNaverConsensus,
     test_getNaverConsensus,
};
