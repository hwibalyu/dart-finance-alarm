const axios = require('axios');
const iconv = require('iconv-lite');
const { xml2js } = require('xml-js');

// 호환성 레이어 및 다른 모듈에서 필요한 함수들을 불러옵니다.
const {
     Logger,
     PropertiesService,
     Utilities,

     Cheerio,
} = require('./gas-compatibility');
const { getNaverQuarterlyEarnings } = require('./financial');
const { getNaverConsensus } = require('./consensus');
const { calculate5QuarterEarnings } = require('./quarter');
const {
     createTelegramCaption,
     sendTelegramMessage,
     sendTelegramMediaGroup,
} = require('./helper');
const {
     generateStockChartImage,
     generatePerPbrBandCharts,
     generateConsensusCharts,
} = require('./charts');

// =================================================================
// SECTION 1: 핵심 로직 헬퍼 함수
// =================================================================

/**
 * 특정 통화의 현재 원화(KRW) 환율을 가져옵니다.
 */
async function getExchangeRate(currencyCode) {
     const fallbackRates = { USD: 1380, CNY: 190, JPY: 9 };
     try {
          const url = `https://open.er-api.com/v6/latest/${currencyCode}`;
          const response = await axios.get(url, {
               validateStatus: () => true,
          });
          if (response.getResponseCode() === 200) {
               const data = response.data;
               const rate = data.rates.KRW;
               if (rate) {
                    Logger.log(
                         ` -> 실시간 환율 조회 성공: 1 ${currencyCode} = ${rate.toFixed(
                              2
                         )} KRW`
                    );
                    return rate;
               }
          }
          Logger.log(
               ` -> 실시간 환율 API 호출 실패. 기본 환율(Fallback)을 사용합니다: ${currencyCode}`
          );
          return fallbackRates[currencyCode];
     } catch (e) {
          Logger.log(
               ` -> 환율 조회 중 오류 발생: ${e.message}. 기본 환율(Fallback)을 사용합니다: ${currencyCode}`
          );
          return fallbackRates[currencyCode];
     }
}

/**
 * URL을 받아 문서의 meta 태그를 분석하여 정확한 인코딩으로 텍스트를 반환합니다.
 */
// 기존 함수를 아래 코드로 교체합니다.
async function getContentTextWithAutoCharset(url) {
     try {
          // 1. axios로 응답을 'arraybuffer' 형태로 받습니다. (가장 중요)
          // 이렇게 해야 텍스트가 깨지지 않은 순수 바이트(byte) 데이터를 얻을 수 있습니다.
          const response = await axios.get(url, {
               responseType: 'arraybuffer',
               validateStatus: () => true, // muteHttpExceptions: true 와 동일
          });

          // 2. HTTP 상태 코드를 확인합니다.
          if (response.status !== 200) {
               Logger.log(
                    ` -> URL fetch 실패 (코드: ${response.status}): ${url}`
               );
               return null;
          }

          // 3. 받은 ArrayBuffer를 Node.js의 Buffer 객체로 변환합니다.
          const responseBuffer = Buffer.from(response.data);

          // 4. 인코딩 감지를 위해 먼저 'latin1'(ISO-8859-1)로 디코딩합니다.
          const rawContent = iconv.decode(responseBuffer, 'latin1');

          // 5. meta 태그에서 charset을 찾습니다.
          const charsetMatch = rawContent.match(/<meta[^>]+charset=([^">]+)/i);

          // 6. 'euc-kr'이 발견되면, 원본 버퍼를 'euc-kr'로 디코딩하여 반환합니다.
          if (
               charsetMatch &&
               charsetMatch[1].toLowerCase().includes('euc-kr')
          ) {
               return iconv.decode(responseBuffer, 'euc-kr');
          }

          // 7. 그렇지 않으면, 원본 버퍼를 기본값인 'utf-8'로 디코딩하여 반환합니다.
          return responseBuffer.toString('utf8');
     } catch (e) {
          // 네트워크 오류 등 요청 자체의 실패를 처리합니다.
          Logger.log(` -> getContentTextWithAutoCharset 오류: ${e.message}`);
          return null;
     }
}

/** 보고서 이름을 분석하여 표준화된 유형을 반환합니다. */
function getReportType(reportName) {
     if (
          reportName.includes('분기보고서') ||
          reportName.includes('반기보고서') ||
          reportName.includes('사업보고서')
     )
          return 'PERIODIC';
     if (
          reportName.includes('재무제표기준영업(잠정)실적') ||
          reportName.includes('영업(잠정)실적(공정공시)') ||
          reportName.includes('매출액또는손익구조30%')
     )
          return 'PRELIMINARY';
     return null;
}

/** [하이브리드 함수] dcmNo, rcpNo를 추출합니다. */
// 기존 함수를 아래 코드로 교체합니다.
async function getDisclosureNumbers(rcpNo) {
     // 1. XML API를 호출하여 파싱하는 내부 함수
     const fetchFromApi = async () => {
          try {
               const url = `https://dart.fss.or.kr/dtd/document.xml?rcpNo=${rcpNo}`;

               // axios로 XML 데이터를 가져옵니다.
               const response = await axios.get(url, {
                    validateStatus: () => true, // muteHttpExceptions: true
               });

               if (response.status !== 200) return null;

               // xml-js로 텍스트를 자바스크립트 객체로 변환합니다.
               // compact: false는 GAS의 XmlService와 유사한 구조를 만듭니다.
               const jsObject = xml2js(response.data, { compact: false });

               // GAS의 XmlService.parse() 결과와 유사한 방식으로 값을 추출합니다.
               const dcmNo = jsObject.elements[0].elements[0].attributes.DCM_NO; // RESULT // PART // { DCM_NO: '...' }

               return { rcpNo, dcmNo };
          } catch (e) {
               // 파싱 오류 또는 네트워크 오류 처리
               Logger.log(` -> fetchFromApi 오류: ${e.message}`);
               return null;
          }
     };

     // 2. HTML을 파싱하는 내부 함수 (이 부분은 변경 없음)
     // 이미 getContentTextWithAutoCharset가 axios를 사용하도록 변환되었기 때문입니다.
     const fetchFromHtml = async () => {
          try {
               const html = await getContentTextWithAutoCharset(
                    `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${rcpNo}`
               );
               if (!html) return null;
               const $ = Cheerio.load(html);
               const btn = $('button.btnDown[onclick*="openPdfDownload"]');
               if (btn.length === 0) return null;
               const matches = btn
                    .attr('onclick')
                    .match(
                         /openPdfDownload\(['"](\d+)['"],\s*['"](\d+)['"]\);?/
                    );
               return matches ? { rcpNo: matches[1], dcmNo: matches[2] } : null;
          } catch (e) {
               Logger.log(` -> fetchFromHtml 오류: ${e.message}`);
               return null;
          }
     };

     // 3. 메인 로직 (이 부분도 변경 없음)
     let numbers = await fetchFromApi();
     if (numbers) {
          Logger.log(` -> API 방식으로 번호 획득 성공.`);
          return numbers;
     }
     Logger.log(` -> API 방식 실패. HTML 파싱으로 재시도...`);
     numbers = await fetchFromHtml();
     if (numbers) {
          Logger.log(` -> HTML 파싱 방식으로 번호 획득 성공.`);
          return numbers;
     }
     Logger.log(` -> 모든 번호 획득 방식 실패.`);
     return null;
}

/**
 * 보고서 유형을 받아 '올바른' 포괄손익계산서 URL 하나를 찾아서 반환합니다.
 */
async function generateReportUrls(reportType, numbers) {
     const baseUrl = 'https://dart.fss.or.kr/report/viewer.do';
     const { rcpNo, dcmNo } = numbers;

     if (reportType === 'PERIODIC') {
          const dtd = 'dart4.xsd';
          const checkEleId = async (eleId) => {
               const checkUrl = `${baseUrl}?rcpNo=${rcpNo}&dcmNo=${dcmNo}&eleId=${eleId}&offset=1234&length=1234&dtd=${dtd}`;
               const htmlContent = await getContentTextWithAutoCharset(
                    checkUrl
               );
               if (!htmlContent) return null;
               const $ = Cheerio.load(htmlContent);
               const titleElements = $('p.section-2, p.table-group-xbrl');
               let foundTitle = null;
               titleElements.each((i, el) => {
                    const titleText = $(el).text();
                    if (/손익계산서/.test(titleText)) {
                         foundTitle = titleText;
                         return false;
                    }
               });
               if (foundTitle) {
                    const isConsolidated = foundTitle.includes('연결');
                    Logger.log(
                         ` -> eleId=${eleId}에서 제목['${foundTitle.trim()}']을 찾았습니다. [${
                              isConsolidated ? '연결' : '개별'
                         }]`
                    );
                    return {
                         finalUrl: checkUrl,
                         statementType: isConsolidated ? '연결' : '개별',
                    };
               }
               return null;
          };
          let reportInfo = await checkEleId(21);
          if (!reportInfo) {
               Logger.log(
                    ' -> eleId=21에서 포괄손익계산서 제목을 찾지 못했습니다. eleId=26으로 재시도합니다.'
               );
               reportInfo = await checkEleId(26);
          }
          if (!reportInfo) {
               Logger.log(
                    ' -> eleId=21, 26에서 포괄손익계산서 제목을 찾지 못했습니다. eleId=19으로 재시도합니다.'
               );
               reportInfo = await checkEleId(19);
          }
          if (!reportInfo) {
               Logger.log(
                    ' -> eleId 21과 26 모두에서 유효한 포괄손익계산서 제목을 찾지 못했습니다.'
               );
          }

          return reportInfo;
     }

     if (reportType === 'PRELIMINARY') {
          return {
               finalUrl: `${baseUrl}?rcpNo=${rcpNo}&dcmNo=${dcmNo}&eleId=0&offset=1234&length=1234&dtd=HTML`,
               statementType: '잠정',
          };
     }
     return null;
}

/**
 * ★★★ [복원 완료] 보고서 유형과 내용에 따라 분기 정보를 추출하는 헬퍼 함수 ★★★
 */
function extractQuarterInfo(report, html) {
     try {
          const reportType = getReportType(report.report_nm);
          const $ = Cheerio.load(html);
          const bodyText = $('body').text().replace(/\s+/g, ' ');

          if (reportType === 'PERIODIC') {
               const dateMatch = bodyText.match(
                    /(\d{4})\s*\.\s*(\d{2})\s*\.\s*(\d{2})\s*까지/
               );
               if (dateMatch) {
                    const year = dateMatch[1].slice(-2);
                    const month = parseInt(dateMatch[2], 10);
                    const quarter = Math.ceil(month / 3);
                    return `${quarter}Q${year}`;
               }
          }

          if (reportType === 'PRELIMINARY') {
               if (report.report_nm.includes('매출액또는손익구조30%')) {
                    const year = parseInt(report.rcept_dt.substring(2, 4), 10);
                    return `4Q${year - 1}`;
               }
               if (bodyText.match(/(\d{2,4}년\s*\d{1,2}월)|\(\d{4}\.\d{2}\)/)) {
                    Logger.log(
                         " -> '월별' 실적으로 판단되어 분석에서 제외합니다."
                    );
                    return 'monthly';
               }

               let quarterMatch = bodyText.match(/\((\d{2,4})\.?(\d{1,2})Q\)/);
               if (!quarterMatch)
                    quarterMatch = bodyText.match(
                         /\('?(\d{2,4})년\s*(\d{1,2})분기\)/
                    );
               if (!quarterMatch)
                    quarterMatch = bodyText.match(
                         /\('?(\d{2,4})\.(\d{1,2})\/\d분기\)/
                    );
               Logger.log(`quarterMatch : ${quarterMatch}`);
               if (quarterMatch) {
                    const year = quarterMatch[1].slice(-2);
                    const q = quarterMatch[2];
                    return `${q}Q${year}`;
               }

               let yearMatch = bodyText.match(/(\d{4})년\s/);
               if (!yearMatch)
                    yearMatch = bodyText.match(
                         /\((\d{4})\.\d{1,2}\.\d{1,2}~\d{4}\.\d{2}\.\d{2}\)/
                    );
               if (yearMatch) {
                    const year = yearMatch[1].slice(-2);
                    return `4Q${year}`;
               }
          }
     } catch (e) {
          Logger.log(` -> 분기 정보 추출 중 오류: ${e.toString()}`);
     }

     Logger.log(' -> 분기 정보를 찾을 수 없습니다.');
     return null;
}

// --- [분리된 실적 추출 함수 1] ---
async function extractPeriodicEarnings(report, reportUrl) {
     const cleanAndParseNumber = (text) => {
          if (!text) return null;
          const cleaned = text
               .trim()
               .replace(/,/g, '')
               .replace(/[^\d.-]/g, '');
          if (cleaned === '') return null;
          if (text.trim().startsWith('(') && text.trim().endsWith(')')) {
               return -parseFloat(cleaned) || 0;
          }
          return parseFloat(cleaned) || 0;
     };

     const getUnitMultiplier = async (html, reportType) => {
          const $ = Cheerio.load(html);
          let targetHtml = html;

          if (reportType === 'PERIODIC') {
               const titleElement = $(
                    'p:contains("손익계산서"), span:contains("손익계산서")'
               ).first();
               if (titleElement.length > 0) {
                    const tableElement = titleElement.closest('table');
                    if (tableElement.length > 0) {
                         targetHtml = tableElement.html();
                    }
               }
          }

          const m = targetHtml.match(
               /\(단위\s*:\s*([^)]+)\)|\s*단위\s*:\s*([^,]+)/
          );
          if (m) {
               const unitText = (m[1] || m[2] || '').toUpperCase();

               let multiplier = 1;

               // 1. 금액 단위 확인
               if (unitText.includes('천원') || unitText.includes('천'))
                    multiplier = 1000;
               else if (
                    unitText.includes('백만원') ||
                    unitText.includes('백만')
               )
                    multiplier = 1000000;
               else if (unitText.includes('억원') || unitText.includes('억'))
                    multiplier = 100000000;

               // 2. 통화 단위 확인 후 곱하기
               if (unitText.includes('USD'))
                    multiplier *= await getExchangeRate('USD');
               else if (unitText.includes('CNY'))
                    multiplier *= await getExchangeRate('CNY');
               else if (unitText.includes('JPY'))
                    multiplier *= await getExchangeRate('JPY');

               return multiplier;
          }

          return 1;
     };

     const html = await getContentTextWithAutoCharset(reportUrl);
     if (!html) {
          return {};
     }

     const unitMultiplier = await getUnitMultiplier(html, 'PERIODIC');
     const $ = Cheerio.load(html);
     const earnings = {
          sales: null,
          operatingProfit: null,
          netIncome: null,
          netIncomeToControllingInterests: null,
     };
     const keywords = {
          sales: /수익\(매출액\)|매출액|영업수익|^매출$/,
          operatingProfit: /영업이익|영업손실|영업손익/,
          netIncome:
               /당기순이익|반기순이익|분기순이익|당기순손실|반기순손실|분기순손실|반기순손익|분기순손익|당기순손익/,
          netIncomeToControllingInterests:
               /지배(기업)?(주주)?지분|지배기업.*귀속/,
     };

     $('tr').each((i, row) => {
          const cells = $(row).find('td, th');
          if (cells.length < 2) return;
          const firstCellText = cells
               .first()
               .text()
               .replace(/\(주\d+\)/g, '')
               .replace(/[\s△\n\r]/g, '');
          for (const [key, pattern] of Object.entries(keywords)) {
               if (earnings[key] === null && pattern.test(firstCellText)) {
                    const valueCell = cells.eq(1);
                    if (valueCell.length > 0) {
                         const parsedValue = cleanAndParseNumber(
                              valueCell.text()
                         );
                         if (parsedValue !== null) {
                              earnings[key] =
                                   (parsedValue * unitMultiplier) / 100000000;
                         }
                    }
               }
          }
     });

     let quarter = null,
          isAnnual = false;
     const bodyText = $('body').text(); // ★★★ 누락되었던 변수 선언 ★★★
     const dateMatch = bodyText.match(
          /(\d{4})\s*\.\s*(\d{2})\s*\.\s*(\d{2})\s*까지/
     );
     if (dateMatch) {
          const year = dateMatch[1].slice(-2);
          const month = parseInt(dateMatch[2], 10);
          const day = parseInt(dateMatch[3], 10);

          if (month === 12 && day >= 28) {
               quarter = `4Q${year}`;
               isAnnual = true;
          } else {
               const q = Math.ceil(month / 3);
               quarter = `${q}Q${year}`;
          }
     }

     return {
          earnings: earnings.sales !== null ? earnings : null,
          quarter,
          unitMultiplier,
          isAnnual,
     };
}

// --- [분리된 실적 추출 함수 2] ---
/**
 * ★★★ [수정 완료] 잠정실적 보고서의 실적, 분기/연간/월별 여부, 연결/개별 여부를 추출합니다. ★★★
 */
async function extractPreliminaryEarnings(report, reportUrl) {
     const cleanAndParseNumber = (text) => {
          if (!text) return null;
          const cleaned = text
               .trim()
               .replace(/,/g, '')
               .replace(/[^\d.-]/g, '');
          if (cleaned === '') return null;
          if (text.trim().startsWith('(') && text.trim().endsWith(')')) {
               return -parseFloat(cleaned) || 0;
          }
          return parseFloat(cleaned) || 0;
     };

     const getUnitMultiplier = async (html, reportType) => {
          const m = html.match(/\(단위\s*:\s*([^)]+)\)|\s*단위\s*:\s*([^,]+)/);
          if (m) {
               const unitText = (m[1] || m[2] || '').toUpperCase();

               let multiplier = 1;

               // 1. 금액 단위 확인
               if (unitText.includes('천원') || unitText.includes('천'))
                    multiplier = 1000;
               else if (
                    unitText.includes('백만원') ||
                    unitText.includes('백만')
               )
                    multiplier = 1000000;
               else if (unitText.includes('억원') || unitText.includes('억'))
                    multiplier = 100000000;
               else if (unitText.includes('조원') || unitText.includes('조'))
                    multiplier = 1000000000000;

               // 2. 통화 단위 확인 후 곱하기
               if (unitText.includes('USD'))
                    multiplier *= await getExchangeRate('USD');
               else if (unitText.includes('CNY'))
                    multiplier *= await getExchangeRate('CNY');
               else if (unitText.includes('JPY'))
                    multiplier *= await getExchangeRate('JPY');

               return multiplier;
          }
          return 1;
     };
     const html = await getContentTextWithAutoCharset(reportUrl);
     if (!html) {
          return {};
     }

     const unitMultiplier = await getUnitMultiplier(html, 'PRELIMINARY');
     const $ = Cheerio.load(html);
     const earnings = {
          sales: null,
          operatingProfit: null,
          netIncome: null,
          netIncomeToControllingInterests: null,
     };

     const parserB = () => {
          Logger.log(' -> Parser B (손익구조30%) 실행...');
          const keywords = {
               sales: '매출액',
               operatingProfit: '영업이익',
               netIncome: '당기순이익',
          };
          let found = false;
          for (const [key, keyword] of Object.entries(keywords)) {
               const labelCell = $(`td:contains("${keyword}")`);
               if (labelCell.length > 0) {
                    const valueCell = labelCell.next('td');
                    if (valueCell.length > 0) {
                         const parsedValue = cleanAndParseNumber(
                              valueCell.text()
                         );
                         if (parsedValue !== null) {
                              earnings[key] =
                                   (parsedValue * unitMultiplier) / 100000000;
                              found = true;
                         }
                    }
               }
          }
          return found ? earnings : null;
     };

     const parserA = () => {
          Logger.log(' -> Parser A (기존 잠정실적) 실행...');
          const keywords = {
               sales: '매출액',
               operatingProfit: '영업이익',
               netIncome: '당기순이익',
               netIncomeToControllingInterests: '지배기업 소유주지분 순이익',
          };
          let found = false;
          $('table tr').each((i, row) => {
               const firstCell = $(row).find('td').first();
               const firstCellText = firstCell.text().trim();
               for (const [key, keyword] of Object.entries(keywords)) {
                    if (firstCellText === keyword && earnings[key] === null) {
                         const targetLabelCell = $(row).find(
                              'td:contains("당해실적"), td:contains("당기실적")'
                         );
                         if (targetLabelCell.length > 0) {
                              const valueCell = targetLabelCell.next('td');
                              if (valueCell.length > 0) {
                                   const parsedValue = cleanAndParseNumber(
                                        valueCell.text()
                                   );
                                   if (parsedValue !== null) {
                                        earnings[key] =
                                             (parsedValue * unitMultiplier) /
                                             100000000;
                                        found = true;
                                   }
                              }
                         }
                    }
               }
          });
          return found ? earnings : null;
     };

     let result = null;
     if (report.report_nm.includes('매출액또는손익구조30%')) {
          result = parserB();
     } else {
          result = parserA();
     }
     Logger.log(result);
     let quarter = null;
     let isAnnual = false;

     // '구분' 셀이 포함된 행의 다음 행을 분석 대상으로 삼음
     const headerRow = $('td:contains("구분")').closest('tr');
     const dataRow = headerRow.next('tr');

     if (dataRow.length > 0) {
          const cell1Text = dataRow.find('td').eq(0).text().replace(/\s+/g, '');
          const cell2Text = dataRow.find('td').eq(1).text().replace(/\s+/g, '');

          // Case 4, 5: 월별 실적 판단 (최우선)
          const monthPattern = /(\d{2,4})년(\d{1,2})월/;
          if (
               monthPattern.test(cell1Text) ||
               monthPattern.test(cell2Text) ||
               (cell1Text.replace(/[-()]/g, '') === '' &&
                    cell2Text.replace(/[-()]/g, '') === '')
          ) {
               quarter = 'monthly';
          } else {
               // Case 1: 연간 실적 판단
               const yearPattern = /(\d{4})년(?!\s*\d+[분기Q])/;
               const annualDatePattern =
                    /(\d{4})\.01\.01\s*~\s*(\d{4})\.12\.31/;

               let yearMatch = cell1Text.match(yearPattern);
               if (!yearMatch) yearMatch = cell1Text.match(annualDatePattern);

               if (yearMatch) {
                    quarter = `4Q${yearMatch[1].slice(-2)}`;
                    isAnnual = true;
               } else {
                    // Case 2, 3: 분기 실적 판단
                    console.log('cell1Text : ', cell1Text);

                    // 먼저 yyyy.mm.dd ~ yyyy.mm.dd 형식 체크 (4자리 년도)
                    const dateRangeMatch = cell1Text.match(
                         /(\d{4})\.(\d{1,2})\.\d{1,2}~/
                    );
                    // 2자리 년도 날짜 범위도 체크 (yy.mm~yy.mm 형식)
                    const shortDateRangeMatch =
                         cell1Text.match(/(\d{2})\.(\d{1,2})~/);

                    if (dateRangeMatch) {
                         const month = parseInt(dateRangeMatch[2], 10);
                         const q = Math.ceil(month / 3);
                         quarter = `${q}Q${dateRangeMatch[1].slice(-2)}`;
                    } else if (shortDateRangeMatch) {
                         const month = parseInt(shortDateRangeMatch[2], 10);
                         const q = Math.ceil(month / 3);
                         quarter = `${q}Q${shortDateRangeMatch[1]}`;
                    } else {
                         let quarterMatch = cell1Text.match(
                              /'?(\d{2,4})\.(\d)[Q분기]/
                         ); // 25.2Q, 25.2분기, '25.2Q, '25.2분기 (점이 있는 경우만)
                         if (!quarterMatch)
                              quarterMatch =
                                   cell1Text.match(/'?(\d{2})(\d)[Q분기]/); // '252Q, '252분기
                         if (!quarterMatch)
                              quarterMatch =
                                   cell1Text.match(/(\d{4})(\d)[Q분기]/); // 20254Q, 20254분기 (점 없는 4자리년도+분기)
                         if (!quarterMatch)
                              quarterMatch = cell1Text.match(
                                   /'?(\d{2})년\s*(\d)[Q분기]/
                              ); // '25년 2Q, 25년2분기
                         if (!quarterMatch)
                              quarterMatch =
                                   cell1Text.match(/(\d{4})년\s*(\d)[Q분기]/); // 2025년 2Q, 2025년2분기
                         if (!quarterMatch)
                              quarterMatch = cell1Text.match(/(\d{2,4})-(\d)Q/); // 2025-2Q
                         if (!quarterMatch)
                              quarterMatch =
                                   cell1Text.match(/(\d)[Q](\d{2,4})/); // 2Q25
                         if (!quarterMatch)
                              quarterMatch =
                                   cell1Text.match(/(\d{2})Y\s*[Q](\d)/); // 25Y Q2
                         if (!quarterMatch)
                              quarterMatch =
                                   cell1Text.match(/(\d{2})\.(\d{2})~/); // 25.04~25.06
                         if (!quarterMatch)
                              quarterMatch =
                                   cell1Text.match(/'?(\d{2,4})\.Q(\d)/); // '25.Q2, 2025.Q4
                         if (!quarterMatch)
                              quarterMatch = cell1Text.match(
                                   /'?(\d{2,4})\.(\d{1,2})\/\d분기/
                              ); // 기존 패턴

                         console.log(quarterMatch, cell1Text);

                         if (quarterMatch) {
                              // 패턴별로 다른 처리
                              if (
                                   cell1Text.includes('Y Q') ||
                                   cell1Text.includes('YQ')
                              ) {
                                   // 25Y Q2 → 2Q25
                                   quarter = `${quarterMatch[2]}Q${quarterMatch[1]}`;
                              } else if (cell1Text.match(/\d[Q]\d{2,4}/)) {
                                   // 2Q25 → 2Q25
                                   quarter = `${
                                        quarterMatch[1]
                                   }Q${quarterMatch[2].slice(-2)}`;
                              } else if (cell1Text.includes('~')) {
                                   // 25.04~25.06 → 월로 분기 계산
                                   const month = parseInt(quarterMatch[2], 10);
                                   const q = Math.ceil(month / 3);
                                   quarter = `${q}Q${quarterMatch[1].slice(
                                        -2
                                   )}`;
                              } else {
                                   // 일반적인 경우: 25.2Q, 25.2분기, 2025-2Q, 2025년 2Q 등
                                   quarter = `${
                                        quarterMatch[2]
                                   }Q${quarterMatch[1].slice(-2)}`;
                              }
                         }
                    }
               }
          }
     }

     // Fallback: 손익구조 30%는 연간으로 간주
     if (!quarter && report.report_nm.includes('매출액또는손익구조30%')) {
          const year = parseInt(report.rcept_dt.substring(2, 4), 10);
          quarter = `4Q${year - 1}`;
          isAnnual = true;
     }

     let statementType = '개별';
     if (report.report_nm.includes('연결재무제표')) {
          statementType = '연결';
     } else if (report.report_nm.includes('매출액또는손익구조30%')) {
          const typeCell = $('td:contains("재무제표의 종류")')
               .nextAll('td')
               .first();
          if (typeCell.length > 0 && typeCell.text().includes('연결')) {
               statementType = '연결';
          }
     }
     Logger.log(isAnnual, quarter);

     return {
          earnings: result,
          quarter,
          statementType,
          unitMultiplier,
          isAnnual,
     };
}

// =================================================================
// SECTION 2: 메인 워크플로우 함수
// =================================================================
async function fetchDisclosureList() {
     const API_KEY =
          PropertiesService.getScriptProperties().getProperty('DART_API_KEY');
     if (!API_KEY) {
          Logger.log('API 키가 설정되지 않았습니다.');
          return null;
     }

     const today = new Date();
     const oneMonthAgo = new Date();
     oneMonthAgo.setMonth(today.getMonth() - 1);
     const formatDate = (date) =>
          `${date.getFullYear()}${('0' + (date.getMonth() + 1)).slice(-2)}${(
               '0' + date.getDate()
          ).slice(-2)}`;
     // const endDate = formatDate(today);
     // const beginDate = formatDate(oneMonthAgo);
     const endDate = '20250220';
     const beginDate = '20250101';

     const TARGET_COUNT = 100; // 원본 값으로 복원했습니다.
     const MAX_PAGES_TO_FETCH = 50;
     let collectedReports = [];
     let pageNo = 1;
     let totalPages = 1;

     try {
          while (
               collectedReports.length < TARGET_COUNT &&
               pageNo <= totalPages &&
               pageNo <= MAX_PAGES_TO_FETCH
          ) {
               Logger.log(
                    `API 목록 조회 시도: Page ${pageNo}... (현재 ${collectedReports.length}/${TARGET_COUNT}개 수집)`
               );
               const apiUrl = `https://opendart.fss.or.kr/api/list.json?crtfc_key=${API_KEY}&bgn_de=${beginDate}&end_de=${endDate}&page_count=100&page_no=${pageNo}`;

               // ============ [변경점 시작] ============
               const response = await axios.get(apiUrl, {
                    // DART API는 에러 발생 시 200 OK와 함께 에러 코드를 JSON으로 반환하므로,
                    // validateStatus 옵션이 필수는 아니지만, 만일을 대비해 추가할 수 있습니다.
                    validateStatus: () => true,
               });

               // axios는 JSON 응답을 자동으로 파싱하여 response.data에 담아줍니다.
               const result = response.data;
               // ============ [변경점 끝] ============

               if (result.status !== '000' || !result.list) {
                    if (result.status === '013') {
                         Logger.log(
                              'API: 해당 기간에 더 이상 조회된 공시가 없습니다.'
                         );
                         break;
                    }
                    Logger.log(`API 오류: ${result.message}`);
                    return null;
               }

               totalPages = result.total_page;

               result.list.forEach((report) => {
                    if (
                         collectedReports.length < TARGET_COUNT &&
                         ['Y', 'K'].includes(report.corp_cls) &&
                         !report.report_nm.includes('정정') &&
                         !report.report_nm.includes('첨부추가') &&
                         !report.report_nm.includes('자회사의 주요경영사항') &&
                         !report.corp_name.includes('스팩') // 스팩인 경우에는 제거
                    ) {
                         const reportType = getReportType(report.report_nm);
                         if (reportType) {
                              collectedReports.push(report);
                         }
                    }
               });

               pageNo++;
               await Utilities.sleep(100);
          }

          Logger.log(`총 ${collectedReports.length}개의 유효 공시 수집 완료.`);
          return collectedReports.slice(0, TARGET_COUNT);
     } catch (e) {
          // axios.get에서 네트워크 연결 실패 등 심각한 오류 발생 시 catch됩니다.
          Logger.log(`API 목록 조회 중 오류 발생: ${e.toString()}`);
          return null;
     }
}

/**
 * ★★★ [수정 완료] 단일 공시 정보를 받아 처리하며, 연간 실적 변환 전 데이터 유효성을 검사합니다. ★★★
 */
async function processSingleDisclosure(report) {
     Logger.log(
          `\n[개별 처리 시작] ${report.corp_name} (${report.stock_code}) - ${report.report_nm}`
     );
     const reportType = getReportType(report.report_nm);

     const numbers = await getDisclosureNumbers(report.rcept_no);
     await Utilities.sleep(200);

     if (!numbers) {
          return { ...report, error: '상세 번호(dcmNo) 획득 실패' };
     }

     const reportInfo = await generateReportUrls(reportType, numbers);
     if (!reportInfo) {
          return { ...report, ...numbers, error: '파싱 URL 생성 실패' };
     }

     Logger.log(' -> 상세 실적 추출 시작...');
     let extractedData;
     if (reportType === 'PERIODIC') {
          extractedData = await extractPeriodicEarnings(
               report,
               reportInfo.finalUrl
          );
     } else if (reportType === 'PRELIMINARY') {
          extractedData = await extractPreliminaryEarnings(
               report,
               reportInfo.finalUrl
          );
     }

     if (extractedData && extractedData.quarter === 'monthly') {
          return {
               ...report,
               ...numbers,
               error: '월별 실적은 분석 대상에서 제외됨',
          };
     }

     if (!extractedData || !extractedData.earnings) {
          return { ...report, ...numbers, error: 'DART 실적 추출 실패' };
     }

     const statementType =
          reportType === 'PERIODIC'
               ? reportInfo.statementType
               : extractedData.statementType;

     Logger.log(
          ` -> 네이버 증권에서 과거 분기 실적 조회 시작... (유형: ${statementType})`
     );
     const naverEarnings = await getNaverQuarterlyEarnings(
          report.stock_code,
          statementType
     );
     await Utilities.sleep(200);

     // ★★★ 해당 분기 컨센서스 데이터 조회 추가 ★★★
     const consensus = await getNaverConsensus(
          report.stock_code,
          statementType,
          extractedData.quarter
     );
     await Utilities.sleep(200);

     // DART 실적만 있는 경우, 네이버 조회 실패 시 그대로 반환
     const createDartOnlyResult = (errorMsg) => {
          const dartQuarterlyData = [];
          for (const [key, value] of Object.entries(extractedData.earnings)) {
               if (value !== null) {
                    dartQuarterlyData.push({
                         quarter: extractedData.quarter,
                         item: key,
                         value: value,
                    });
               }
          }
          return {
               ...report,
               ...numbers,
               quarterlyEarnings: dartQuarterlyData,
               statementType,
               unitMultiplier: extractedData.unitMultiplier,
               error: errorMsg,
          };
     };

     if (!naverEarnings) {
          Logger.log(
               ' -> 네이버 증권 데이터 조회 실패. DART 실적만 반환합니다.'
          );
          return createDartOnlyResult('과거 분기 데이터 조회 실패');
     }

     // ★★★ 연간 실적 변환 전, 데이터 유효성 검사 ★★★
     if (extractedData.isAnnual) {
          const year = extractedData.quarter.slice(2);
          const quartersInYear = new Set(
               naverEarnings
                    .filter(
                         (d) => d.quarter.endsWith(year) && d.item === 'sales'
                    )
                    .map((d) => d.quarter)
          );
          const hasAllPreviousQuarters =
               quartersInYear.has(`1Q${year}`) &&
               quartersInYear.has(`2Q${year}`) &&
               quartersInYear.has(`3Q${year}`);

          if (!hasAllPreviousQuarters) {
               Logger.log(
                    ` -> 이전 분기 데이터 부족으로 4분기 실적 계산을 건너뜁니다. (필요: 1Q${year}, 2Q${year}, 3Q${year} / 확인: ${[
                         ...quartersInYear,
                    ].join(', ')})`
               );
               return createDartOnlyResult(
                    '4분기 계산을 위한 이전 분기 데이터 부족'
               );
          }
     }

     Logger.log(' -> DART 실적과 네이버 실적 데이터 통합 및 계산...');
     const final5QuartersData = calculate5QuarterEarnings(
          extractedData,
          naverEarnings
     );

     return {
          ...report,
          ...numbers,
          statementType,
          quarterlyEarnings: final5QuartersData,
          unitMultiplier: extractedData.unitMultiplier,
          consensus: consensus, // ★★★ 최종 결과에 컨센서스 추가 ★★★
     };
}

/**
 * ★★★ [수정 완료] 메인 워크플로우 함수. Markdown 캡션에 최신 공시 실적 요약을 추가합니다. ★★★
 */
async function runSequentialProcessing() {
     try {
          Logger.log('--- 전체 공시 순차 처리 시작 ---');
          const reportsToProcess = await fetchDisclosureList();

          if (!reportsToProcess) {
               Logger.log('테스트 실패: 공시 목록을 가져오는 데 실패했습니다.');
               await sendTelegramMessage(
                    '🚨 DART 공시 목록을 가져오는 데 실패했습니다.'
               );
               return;
          }
          if (reportsToProcess.length === 0) {
               Logger.log('테스트 완료: 조건에 맞는 공시 없음');
               return;
          }

          for (const [index, report] of reportsToProcess.entries()) {
               const result = await processSingleDisclosure(report);
               Logger.log(
                    `[개별 처리 완료 ${index + 1}/${reportsToProcess.length}] ${
                         report.corp_name
                    } -> 결과: ${result.quarterlyEarnings ? '성공' : '실패'}`
               );

               const mediaBlobs = [];

               // 차트 이미지 생성
               Logger.log(' -> 차트 이미지 생성 시도...');
               const stockChart = await generateStockChartImage(
                    result.stock_code,
                    result.corp_name
               );
               if (stockChart) mediaBlobs.push(stockChart);
               const bandCharts = await generatePerPbrBandCharts(
                    result.stock_code
               );
               if (bandCharts) {
                    if (bandCharts.perChart)
                         mediaBlobs.push(bandCharts.perChart);
                    if (bandCharts.pbrChart)
                         mediaBlobs.push(bandCharts.pbrChart);
               }
               const consensusCharts = await generateConsensusCharts(
                    'A' + result.stock_code,
                    new Date().getFullYear() + '12'
               );
               if (consensusCharts) {
                    if (consensusCharts.revenueChart)
                         mediaBlobs.push(consensusCharts.revenueChart);
                    if (consensusCharts.opChart)
                         mediaBlobs.push(consensusCharts.opChart);
               }

               // 캡션 생성은 헬퍼 함수에 위임
               const caption = createTelegramCaption(result);

               // 텔레그램 전송
               if (mediaBlobs.length > 0) {
                    Logger.log('미디어를 텔레그램으로 전송합니다.');
                    await sendTelegramMediaGroup(mediaBlobs, caption);
               } else {
                    Logger.log('텍스트를 텔레그램으로 전송합니다.');
                    await sendTelegramMessage(caption);
               }

               await Utilities.sleep(200);
          }
     } catch (e) {
          Logger.log(`error 발생 !! ${e.stack}`);
     }

     Logger.log(`\n--- 전체 공시 순차 처리 완료 ---`);
}

// =================================================================
// SECTION 3: 테스트 실행 함수
// =================================================================

function getUnitText(multiplier) {
     if (multiplier === 1000) return '천원';
     if (multiplier === 1000000) return '백만원';
     if (multiplier === 100000000) return '억원';
     if (multiplier > 1000 && multiplier < 2000) return 'USD';
     if (multiplier > 150 && multiplier < 250) return 'CNY';
     if (multiplier > 5 && multiplier < 15) return 'JPY';
     return '원';
}

function logPrettySingleResult(report, index, total) {
     if (!report) return;

     Logger.log(`--- 개별 처리 결과 요약 (${index + 1}/${total}) ---`);
     let output = `🏢 ${report.corp_name} (${report.stock_code})\n`;
     output += `📜 보고서명: ${report.report_nm}\n`;

     if (report.quarterlyEarnings && report.quarterlyEarnings.length > 0) {
          const latestQuarterInfo = report.quarterlyEarnings[0];
          const unitText = getUnitText(report.unitMultiplier || 1);

          output += `📑 재무제표: ${report.statementType} (${latestQuarterInfo.quarter})\n`;
          // output += `✅ 실적 추출 및 통합 성공 (단위: ${unitText})\n`;
          output += `-------------------------------------\n`;

          const earningsByQuarter = report.quarterlyEarnings.reduce(
               (acc, curr) => {
                    if (!acc[curr.quarter]) acc[curr.quarter] = {};
                    acc[curr.quarter][curr.item] = curr.value;
                    return acc;
               },
               {}
          );

          for (const quarter in earningsByQuarter) {
               const qEarnings = earningsByQuarter[quarter];
               // 이미 억원 단위로 계산되어 있음
               output += `  [${quarter}] 매출:${formatNumberWithCommas(
                    qEarnings.sales
               )} / 영익:${formatNumberWithCommas(
                    qEarnings.operatingProfit
               )} / 당순:${formatNumberWithCommas(
                    qEarnings.netIncome
               )} (억원)\n`;
          }
          output += `-------------------------------------`;
     } else {
          output += `❌ 실적 추출/통합 실패 또는 데이터 없음`;
          if (report.error) output += ` (사유: ${report.error})`;
     }
     Logger.log(output + '\n');
}

function formatNumberWithCommas(num) {
     if (num === null || num === undefined) return 'N/A';
     // 소수점 3자리까지 표시
     return num.toLocaleString('ko-KR', {
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
     });
}

async function runFullProcessAndLogResults() {
     await runSequentialProcessing();
}

async function testSingleRcpNo_AutoDetect(rcpNo) {
     // ... (rcpNo 목록은 원본과 동일)
     // const rcpNo = '20250813001607'; // 효성화학 25년 2분기 보고서
     // const rcpNo = '20250812900500' // 아이크래프트 잠정실적
     // const rcpNo = '20250731800044'; // 키움증권 25년 2분기 보고서
     Logger.log(`--- 단일 접수번호(${rcpNo}) 자동 감지 테스트 시작 ---`);

     const mainPageUrl = `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${rcpNo}`;
     const html = await getContentTextWithAutoCharset(mainPageUrl);
     if (!html) {
          Logger.log(
               ' -> 보고서 페이지 로딩에 실패했습니다. 테스트를 중단합니다.'
          );
          return;
     }

     const $ = Cheerio.load(html);
     const report_nm = $('title').text().trim();

     const testReport = {
          report_nm: report_nm,
          rcept_dt: rcpNo.substring(0, 8),
          reportType: getReportType(report_nm),
     };

     Logger.log(` -> 보고서명 획득 성공: "${testReport.report_nm}"`);
     Logger.log(` -> 보고서 유형: '${testReport.reportType}'`);

     const numbers = await getDisclosureNumbers(rcpNo);
     if (!numbers) {
          Logger.log(' -> dcmNo 획득에 실패했습니다. 테스트를 중단합니다.');
          return;
     }
     Logger.log(` -> 번호 획득 성공: ${JSON.stringify(numbers)}`);

     const reportInfo = await generateReportUrls(
          testReport.reportType,
          numbers
     );
     if (!reportInfo) {
          Logger.log(' -> 파싱 URL 생성에 실패했습니다. 테스트를 중단합니다.');
          return;
     }
     Logger.log(
          ` -> URL 생성 성공: [${reportInfo.statementType}] ${reportInfo.finalUrl}`
     );

     let extractedData;
     if (testReport.reportType === 'PERIODIC') {
          extractedData = await extractPeriodicEarnings(
               testReport,
               reportInfo.finalUrl
          );
     } else if (testReport.reportType === 'PRELIMINARY') {
          extractedData = await extractPreliminaryEarnings(
               testReport,
               reportInfo.finalUrl
          );
     }

     if (extractedData && extractedData.earnings) {
          Logger.log('\n--- ✅ 추출 성공 ---');
          // Logger.log(`분기 정보: ${extractedData.quarter}`);
          Logger.log(JSON.stringify(extractedData, null, 2));
     } else {
          Logger.log('\n--- ❌ 추출 실패 ---');
          Logger.log(
               `최종 실패 데이터: ${JSON.stringify(extractedData, null, 2)}`
          );
     }
     Logger.log('\n--- 단일 접수번호 자동 감지 테스트 종료 ---');
}

// =================================================================
// SECTION 4: 스크립트 실행
// =================================================================
// 이 파일(main.js)을 실행할 때 어떤 함수를 호출할지 결정합니다.
// 아래 함수들 중 실행하고 싶은 함수의 주석을 해제하세요.

(async () => {
     await testSingleRcpNo_AutoDetect('20250220900343');
     // await runFullProcessAndLogResults();
})();
