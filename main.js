const axios = require('axios');
const iconv = require('iconv-lite');
const { xml2js } = require('xml-js');
const fs = require('fs'); // [추가] 파일 시스템 모듈

// 호환성 레이어 및 다른 모듈에서 필요한 함수들을 불러옵니다.
const {
     Logger,
     PropertiesService,
     Utilities,
     Cheerio,
} = require('./gas-compatibility');
const { getQuarterlyEarnings, getMarketCap } = require('./financial');
const { getNaverConsensus } = require('./consensus');
const { calculate5QuarterEarnings } = require('./quarter');
const {
     createTelegramCaption,
     sendTelegramMessage,
     sendTelegramMediaGroup,
     calculateImportanceScore,
} = require('./helper');
const {
     generateStockChartImage,
     generatePerPbrBandCharts,
     generateConsensusCharts,
} = require('./charts');

// =================================================================
// SECTION 0: [신규] 파일 I/O 헬퍼 함수
// =================================================================

const LAST_RCP_NO_FILE = 'last_rcp.txt';

function getLastRcpNo() {
     try {
          if (fs.existsSync(LAST_RCP_NO_FILE)) {
               const rcpNo = fs.readFileSync(LAST_RCP_NO_FILE, 'utf-8').trim();
               return rcpNo || null;
          }
     } catch (e) {
          Logger.log(
               ` -> last_rcp.txt 파일 읽기 오류: ${e.message}. null을 반환합니다.`
          );
     }
     return null;
}

function saveLastRcpNo(rcpNo) {
     try {
          fs.writeFileSync(LAST_RCP_NO_FILE, rcpNo, 'utf-8');
          Logger.log(` -> 최신 접수번호 ${rcpNo} 저장 완료.`);
     } catch (e) {
          Logger.log(` -> last_rcp.txt 파일 저장 오류: ${e.message}`);
     }
}

// =================================================================
// SECTION 1: 핵심 로직 헬퍼 함수
// =================================================================

async function getExchangeRate(currencyCode) {
     const fallbackRates = { USD: 1380, CNY: 190, JPY: 9 };
     try {
          const url = `https://open.er-api.com/v6/latest/${currencyCode}`;
          const response = await axios.get(url, { validateStatus: () => true });
          if (response.status === 200) {
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

async function getContentTextWithAutoCharset(url) {
     try {
          const response = await axios.get(url, {
               responseType: 'arraybuffer',
               validateStatus: () => true,
          });

          if (response.status !== 200) {
               Logger.log(
                    ` -> URL fetch 실패 (코드: ${response.status}): ${url}`
               );
               return null;
          }

          const responseBuffer = Buffer.from(response.data);
          const rawContent = iconv.decode(responseBuffer, 'latin1');
          const charsetMatch = rawContent.match(/<meta[^>]+charset=([^">]+)/i);

          if (
               charsetMatch &&
               charsetMatch[1].toLowerCase().includes('euc-kr')
          ) {
               return iconv.decode(responseBuffer, 'euc-kr');
          }

          return responseBuffer.toString('utf8');
     } catch (e) {
          Logger.log(` -> getContentTextWithAutoCharset 오류: ${e.message}`);
          return null;
     }
}

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

async function getDisclosureNumbers(rcpNo) {
     const fetchFromApi = async () => {
          try {
               const url = `https://dart.fss.or.kr/dtd/document.xml?rcpNo=${rcpNo}`;
               const response = await axios.get(url, {
                    validateStatus: () => true,
               });
               if (response.status !== 200) return null;
               const jsObject = xml2js(response.data, { compact: false });
               const dcmNo = jsObject.elements[0].elements[0].attributes.DCM_NO;
               return { rcpNo, dcmNo };
          } catch (e) {
               Logger.log(` -> fetchFromApi 오류: ${e.message}`);
               return null;
          }
     };

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

async function generateReportUrls(reportType, numbers) {
     const baseUrl = 'https://dart.fss.or.kr/report/viewer.do';
     const { rcpNo, dcmNo } = numbers;

     if (reportType === 'PERIODIC') {
          const dtd = 'dart4.xsd';
          const eleIdsToSearch = [21, 26, 19];
          let individualReport = null;

          const checkEleId = async (eleId) => {
               const checkUrl = `${baseUrl}?rcpNo=${rcpNo}&dcmNo=${dcmNo}&eleId=${eleId}&offset=1234&length=1234&dtd=${dtd}`;
               const htmlContent = await getContentTextWithAutoCharset(
                    checkUrl
               );
               if (!htmlContent) return null;
               const $ = Cheerio.load(htmlContent);
               const titleElement = $('p:contains("손익계산서")').first();
               if (titleElement.length > 0) {
                    const foundTitle = titleElement.text();
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

          for (const eleId of eleIdsToSearch) {
               const reportInfo = await checkEleId(eleId);
               if (reportInfo) {
                    if (reportInfo.statementType === '연결') {
                         Logger.log(
                              ` -> '연결' 보고서를 eleId=${eleId}에서 찾았으므로 즉시 반환합니다.`
                         );
                         return reportInfo;
                    }
                    if (!individualReport) {
                         individualReport = reportInfo;
                         Logger.log(
                              ` -> '개별' 보고서를 eleId=${eleId}에서 찾았습니다. 계속해서 '연결'을 탐색합니다.`
                         );
                    }
               }
               await Utilities.sleep(500);
          }

          if (individualReport) {
               Logger.log(
                    ` -> '연결' 보고서를 찾지 못해 차선책인 '개별' 보고서를 반환합니다.`
               );
               return individualReport;
          }

          Logger.log(
               ` -> eleId ${eleIdsToSearch.join(
                    ', '
               )} 에서 유효한 손익계산서를 찾지 못했습니다.`
          );
          return null;
     }

     if (reportType === 'PRELIMINARY') {
          return {
               finalUrl: `${baseUrl}?rcpNo=${rcpNo}&dcmNo=${dcmNo}&eleId=0&offset=1234&length=1234&dtd=HTML`,
               statementType: '잠정',
          };
     }

     return null;
}

async function extractPeriodicEarnings(report, reportUrl) {
     // ... 이 함수는 변경되지 않았으므로 기존 코드를 그대로 사용합니다 ...
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
          sales: /(수익\(매출액\)|매출액|영업수익|매출)(\s*\(주(?:석)? [^)]+\))?/,
          operatingProfit:
               /(영업이익|영업손실|영업손익)(\s*\(주(?:석)? [^)]+\))?/,
          netIncome:
               /(당기순이익|반기순이익|분기순이익|당기순손실|반기순손실|분기순손실|반기순손익|분기순손익|당기순손익)(\s*\(주(?:석)? [^)]+\))?/,
          netIncomeToControllingInterests:
               /(지배(기업)?(주주)?지분|지배기업.*귀속)(\s*\(주(?:석)? [^)]+\))?/,
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
     const bodyText = $('body').text();
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

async function extractPreliminaryEarnings(report, reportUrl) {
     // ... 이 함수는 변경되지 않았으므로 기존 코드를 그대로 사용합니다 ...
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
               const regex = new RegExp(`^.*${keyword}\\s*$`);

               const labelCell = $('td').filter(function () {
                    return regex.test($(this).text().trim());
               });

               if (labelCell.length > 0) {
                    const valueCell = labelCell.next('td');
                    console.log(`valueCell : ${valueCell.text()}`);
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

     const headerRow = $('td:contains("구분")').closest('tr');
     const dataRow = headerRow.next('tr');

     if (dataRow.length > 0) {
          const cell1Text = dataRow.find('td').eq(0).text().replace(/\s+/g, '');
          const cell2Text = dataRow.find('td').eq(1).text().replace(/\s+/g, '');
          const monthPattern = /(\d{2,4})년(\d{1,2})월/;
          if (
               monthPattern.test(cell1Text) ||
               monthPattern.test(cell2Text) ||
               (cell1Text.replace(/[-()]/g, '') === '' &&
                    cell2Text.replace(/[-()]/g, '') === '')
          ) {
               quarter = 'monthly';
          } else {
               const yearPattern = /(\d{4})년(?!\s*\d+[분기Q])/;
               const annualDatePattern =
                    /(\d{4})\.01\.01\s*~\s*(\d{4})\.12\.31/;

               let yearMatch = cell1Text.match(yearPattern);
               if (!yearMatch) yearMatch = cell1Text.match(annualDatePattern);

               if (yearMatch) {
                    quarter = `4Q${yearMatch[1].slice(-2)}`;
                    isAnnual = true;
               } else {
                    const dateRangeMatch = cell1Text.match(
                         /(\d{4})\.(\d{1,2})\.\d{1,2}~/
                    );
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
                         );
                         if (!quarterMatch)
                              quarterMatch =
                                   cell1Text.match(/'?(\d{2})(\d)[Q분기]/);
                         if (!quarterMatch)
                              quarterMatch =
                                   cell1Text.match(/(\d{4})(\d)[Q분기]/);
                         if (!quarterMatch)
                              quarterMatch = cell1Text.match(
                                   /'?(\d{2})년\s*(\d)[Q분기]/
                              );
                         if (!quarterMatch)
                              quarterMatch =
                                   cell1Text.match(/(\d{4})년\s*(\d)[Q분기]/);
                         if (!quarterMatch)
                              quarterMatch = cell1Text.match(/(\d{2,4})-(\d)Q/);
                         if (!quarterMatch)
                              quarterMatch =
                                   cell1Text.match(/(\d)[Q](\d{2,4})/);
                         if (!quarterMatch)
                              quarterMatch =
                                   cell1Text.match(/(\d{2})Y\s*[Q](\d)/);
                         if (!quarterMatch)
                              quarterMatch =
                                   cell1Text.match(/(\d{2})\.(\d{2})~/);
                         if (!quarterMatch)
                              quarterMatch =
                                   cell1Text.match(/'?(\d{2,4})\.Q(\d)/);
                         if (!quarterMatch)
                              quarterMatch = cell1Text.match(
                                   /'?(\d{2,4})\.(\d{1,2})\/\d분기/
                              );

                         console.log(quarterMatch, cell1Text);

                         if (quarterMatch) {
                              if (
                                   cell1Text.includes('Y Q') ||
                                   cell1Text.includes('YQ')
                              ) {
                                   quarter = `${quarterMatch[2]}Q${quarterMatch[1]}`;
                              } else if (cell1Text.match(/\d[Q]\d{2,4}/)) {
                                   quarter = `${
                                        quarterMatch[1]
                                   }Q${quarterMatch[2].slice(-2)}`;
                              } else if (cell1Text.includes('~')) {
                                   const month = parseInt(quarterMatch[2], 10);
                                   const q = Math.ceil(month / 3);
                                   quarter = `${q}Q${quarterMatch[1].slice(
                                        -2
                                   )}`;
                              } else {
                                   quarter = `${
                                        quarterMatch[2]
                                   }Q${quarterMatch[1].slice(-2)}`;
                              }
                         }
                    }
               }
          }
     }

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

/**
 * DART API에서 공시 목록을 가져오는 함수
 */
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
     const endDate = '20250801';
     const beginDate = '20250701';

     const lastRcpNo = getLastRcpNo();
     Logger.log(
          lastRcpNo
               ? `마지막 처리된 접수번호: ${lastRcpNo}. 이후 공시만 가져옵니다.`
               : '저장된 접수번호가 없습니다. 최신 공시부터 가져옵니다.'
     );

     const TARGET_COUNT = 10; // ★★★ 여기서 수집할 최대 개수를 설정합니다 ★★★
     const MAX_PAGES_TO_FETCH = 50;
     let collectedReports = [];
     let pageNo = 1;
     let totalPages = 1;
     let stopCollecting = false;

     try {
          // ★★★ [수정] while 루프 조건에 TARGET_COUNT 체크 추가 ★★★
          while (
               !stopCollecting &&
               collectedReports.length < TARGET_COUNT &&
               pageNo <= totalPages &&
               pageNo <= MAX_PAGES_TO_FETCH
          ) {
               Logger.log(
                    `API 목록 조회 시도: Page ${pageNo}... (현재 ${collectedReports.length}/${TARGET_COUNT}개 수집)`
               );
               const apiUrl = `https://opendart.fss.or.kr/api/list.json?crtfc_key=${API_KEY}&bgn_de=${beginDate}&end_de=${endDate}&page_count=100&page_no=${pageNo}`;

               const response = await axios.get(apiUrl, {
                    validateStatus: () => true,
               });
               const result = response.data;

               if (result.status !== '000' || !result.list) {
                    if (result.status === '013') {
                         Logger.log('API: 조회된 공시가 없습니다.');
                         break;
                    }
                    Logger.log(`API 오류: ${result.message}`);
                    return null;
               }

               totalPages = result.total_page;

               for (const report of result.list) {
                    if (lastRcpNo && report.rcept_no === lastRcpNo) {
                         Logger.log(
                              ` -> 이전에 처리한 공시(${lastRcpNo})에 도달하여 수집을 중단합니다.`
                         );
                         stopCollecting = true;
                         break;
                    }

                    // ★★★ [수정] 필터링된 공시를 추가하기 전에도 TARGET_COUNT를 확인 ★★★
                    if (collectedReports.length >= TARGET_COUNT) {
                         Logger.log(
                              ` -> TARGET_COUNT(${TARGET_COUNT}개)에 도달하여 수집을 중단합니다.`
                         );
                         stopCollecting = true;
                         break;
                    }

                    if (
                         ['Y', 'K'].includes(report.corp_cls) &&
                         !report.report_nm.includes('정정') &&
                         !report.report_nm.includes('연장') &&
                         !report.report_nm.includes('첨부추가') &&
                         !report.report_nm.includes('자회사의 주요경영사항') &&
                         !report.corp_name.includes('스팩')
                    ) {
                         const reportType = getReportType(report.report_nm);
                         if (reportType) {
                              collectedReports.push(report);
                         }
                    }
               }

               pageNo++;
               await Utilities.sleep(100);
          }

          Logger.log(`총 ${collectedReports.length}개의 신규 공시 수집 완료.`);

          collectedReports.reverse();
          return collectedReports;
     } catch (e) {
          Logger.log(`API 목록 조회 중 오류 발생: ${e.toString()}`);
          return null;
     }
}

/**
 * 단일 공시 처리 함수
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

     const marketCap = await getMarketCap(report.stock_code);
     await Utilities.sleep(200);

     Logger.log(` -> 과거 분기 실적 조회 시작... (유형: ${statementType})`);
     const naverEarnings = await getQuarterlyEarnings(
          report.stock_code,
          statementType
     );
     await Utilities.sleep(200);

     const consensus = await getNaverConsensus(
          report.stock_code,
          statementType,
          extractedData.quarter
     );
     await Utilities.sleep(200);

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
               marketCap,
               error: errorMsg,
          };
     };

     if (!naverEarnings) {
          Logger.log(' -> 과거 분기 데이터 조회 실패. DART 실적만 반환합니다.');
          return createDartOnlyResult('과거 분기 데이터 조회 실패');
     }

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
                    ` -> 이전 분기 데이터 부족으로 4분기 실적 계산을 건너뜁니다.`
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

     Logger.log(' -> 실적 중요도 점수 계산...');
     const importanceScores = calculateImportanceScore(
          final5QuartersData,
          consensus
     );

     return {
          ...report,
          ...numbers,
          statementType,
          quarterlyEarnings: final5QuartersData,
          unitMultiplier: extractedData.unitMultiplier,
          consensus: consensus,
          importanceScores: importanceScores,
          marketCap: marketCap,
     };
}

/**
 * 메인 워크플로우 함수
 */
async function runSequentialProcessing() {
     try {
          Logger.log('--- 전체 공시 순차 처리 시작 ---');
          const reportsToProcess = await fetchDisclosureList();

          if (!reportsToProcess) {
               Logger.log('처리 실패: 공시 목록을 가져오는 데 실패했습니다.');
               await sendTelegramMessage(
                    '🚨 DART 공시 목록을 가져오는 데 실패했습니다.'
               );
               return;
          }
          if (reportsToProcess.length === 0) {
               Logger.log('처리 완료: 새로운 실적 공시가 없습니다.');
               return;
          }

          for (const [index, report] of reportsToProcess.entries()) {
               const result = await processSingleDisclosure(report);
               const isSuccess = result && result.quarterlyEarnings;

               Logger.log(
                    `[개별 처리 완료 ${index + 1}/${reportsToProcess.length}] ${
                         report.corp_name
                    } -> 결과: ${isSuccess ? '성공' : '실패/건너뜀'}`
               );

               if (isSuccess) {
                    const mediaBlobs = [];
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

                    const caption = createTelegramCaption(result);

                    if (mediaBlobs.length > 0) {
                         Logger.log(' -> 미디어를 텔레그램으로 전송합니다.');
                         await sendTelegramMediaGroup(mediaBlobs, caption);
                    } else {
                         Logger.log(' -> 텍스트를 텔레그램으로 전송합니다.');
                         await sendTelegramMessage(caption);
                    }

                    saveLastRcpNo(result.rcept_no);
               }

               await Utilities.sleep(500);
          }
     } catch (e) {
          Logger.log(`처리 중 심각한 오류 발생 !! ${e.stack}`);
     }

     Logger.log(`\n--- 전체 공시 순차 처리 완료 ---`);
}

// =================================================================
// SECTION 3: 테스트 실행 함수
// =================================================================
// (이 섹션의 코드는 변경 사항이 없습니다. 기존 코드 그대로 유지)

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
     return num.toLocaleString('ko-KR', {
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
     });
}

async function runFullProcessAndLogResults() {
     await runSequentialProcessing();
}

async function testSingleRcpNo_AutoDetect(rcpNo) {
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
(async () => {
     // await testSingleRcpNo_AutoDetect("000020")
     await runFullProcessAndLogResults();
})();
