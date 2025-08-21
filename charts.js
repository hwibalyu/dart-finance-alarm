const { Logger, Utilities, CacheService } = require('./gas-compatibility');
const { sendTelegramMediaGroup } = require('./helper');
const axios = require('axios');

const fs = require('fs');

const echarts = require('echarts');
const { createCanvas } = require('canvas');
const { SMA } = require('technicalindicators');

// ====================================================================
// ============== 메인 함수 (새로운 차트 함수 호출하도록 수정) =============
// ====================================================================

async function generateStockChartImage(symbol, stockName) {
     try {
          const today = new Date();
          const oneYearAgo = new Date();
          oneYearAgo.setFullYear(today.getFullYear() - 1);
          const endTime = Utilities.formatDate(today, 'Asia/Seoul', 'yyyyMMdd');
          const startTime = Utilities.formatDate(
               oneYearAgo,
               'Asia/Seoul',
               'yyyyMMdd'
          );

          // Logger.log(`[${stockName}] 1년치 주가 데이터 수집 중...`);
          const stockData = await fetchStockData(symbol, startTime, endTime);

          if (!stockData || stockData.length <= 1) {
               Logger.log('차트 생성을 위한 주가 데이터가 부족합니다.');
               return null;
          }

          const title = `[${stockName} (${symbol})] 최근 1년 주가`;
          // Logger.log('차트 이미지 생성 중...');
          // [수정] 새로운 로컬 차트 생성 함수 호출
          return await createStockChart(stockData, title);
     } catch (e) {
          Logger.log(`차트 이미지 생성 중 오류: ${e.toString()}`);
          return null;
     }
}

async function generatePerPbrBandCharts(symbol) {
     try {
          // Logger.log(`[${symbol}] PER/PBR 밴드 데이터 수집을 시작합니다...`);
          const rawData = await fetchBandChartData(symbol);
          if (!rawData) {
               Logger.log('밴드 차트 데이터를 가져오는 데 실패했습니다.');
               return null;
          }
          // Logger.log('데이터 수집 성공.');

          // Logger.log('PER 밴드 차트 생성을 시작합니다...');
          const perData = parseBandDataForGoogleCharts(rawData.bandChart1);

          // [수정] 새로운 로컬 차트 생성 함수 호출
          const perChartBlob = perData
               ? await createBandChart(perData, 'PER 차트')
               : null;
          if (!perChartBlob) Logger.log('PER 밴드 차트 생성에 실패했습니다.');

          // Logger.log('PBR 밴드 차트 생성을 시작합니다...');
          const pbrData = parseBandDataForGoogleCharts(rawData.bandChart2);

          // [수정] 새로운 로컬 차트 생성 함수 호출
          const pbrChartBlob = pbrData
               ? await createBandChart(pbrData, 'PBR 차트')
               : null;
          if (!pbrChartBlob) Logger.log('PBR 밴드 차트 생성에 실패했습니다.');

          if (perChartBlob || pbrChartBlob) {
               // Logger.log('모든 밴드 차트 생성이 완료되었습니다.');
               return { perChart: perChartBlob, pbrChart: pbrChartBlob };
          }
          return null;
     } catch (e) {
          Logger.log(`밴드 차트 생성 중 오류 발생: ${e.toString()}`);
          return null;
     }
}

async function generateConsensusCharts(stockCode, year) {
     if (!stockCode || !year) {
          Logger.log('오류: 종목 코드와 연도를 입력해야 합니다.');
          return null;
     }
     try {
          const companyInfo = await getCompanyInfoByCode(stockCode);
          if (!companyInfo) {
               Logger.log(
                    `[${stockCode}]에 해당하는 회사 정보를 찾을 수 없습니다.`
               );
               return null;
          }
          const { id: companyId, name: companyName } = companyInfo;

          Logger.log(
               `[${companyName}(${stockCode})] -> Company ID [${companyId}] 조회 성공.`
          );
          // Logger.log(
          //      `[${companyId} - ${year}] 컨센서스 데이터 수집을 시작합니다...`
          // );
          const consensusData = await fetchConsensusData(companyId, year);
          if (!consensusData || consensusData.length === 0) {
               Logger.log(
                    '컨센서스 데이터를 가져오는 데 실패했거나 데이터가 없습니다.'
               );
               return null;
          }
          // Logger.log(`데이터 수집 성공. (총 ${consensusData.length}개)`);

          const revenueChartData = [['날짜', '매출액']];
          const opChartData = [['날짜', '영업이익']];
          consensusData.forEach((item) => {
               revenueChartData.push([new Date(item.date), item.revenue]);
               opChartData.push([new Date(item.date), item.operatingProfit]);
          });

          // [수정] 새로운 로컬 차트 생성 함수 호출
          const revenueChartBlob = await createConsensusLineChart(
               revenueChartData,
               `${companyName} (${year.substring(
                    0,
                    4
               )}년) 매출액 컨센서스 추이`,
               '#0057FF'
          );
          const opChartBlob = await createConsensusLineChart(
               opChartData,
               `${companyName} (${year.substring(
                    0,
                    4
               )}년) 영업이익 컨센서스 추이`,
               '#D32F2F'
          );

          if (revenueChartBlob && opChartBlob) {
               return { revenueChart: revenueChartBlob, opChart: opChartBlob };
          }
          return null;
     } catch (e) {
          Logger.log(`컨센서스 차트 생성 중 오류 발생: ${e.toString()}`);
          return null;
     }
}

/**
 * Apache ECharts를 사용하여 주가 데이터와 제목을 받아 캔들차트 이미지를 Blob 형태로 생성하는 함수
 * @param {Array<Array<string|number>>} stockData - 주식 데이터 배열
 * @param {string} title - 차트 제목 (예: '삼성전자')
 * @returns {Promise<Blob>} - 생성된 차트 이미지 Blob
 */
async function createStockChart(stockData, title) {
     // --- 1. 데이터 가공 (ECharts 형식에 맞게 변환) ---
     const data = stockData.slice(1);

     const dates = data.map((item) => {
          const dateStr = item[0].toString();
          return `${dateStr.substring(0, 4)}-${dateStr.substring(
               4,
               6
          )}-${dateStr.substring(6, 8)}`;
     });

     const ohlcData = data.map((item) => [
          Number(item[1]), // 시가(open)
          Number(item[4]), // 종가(close)
          Number(item[3]), // 저가(low)
          Number(item[2]), // 고가(high)
     ]);

     // 거래량 데이터 (상승은 빨간색, 하락은 파란색으로 지정)
     const volumeData = data.map((item, index) => ({
          value: Number(item[5]),
          itemStyle: {
               color:
                    ohlcData[index][1] >= ohlcData[index][0]
                         ? '#ef5350'
                         : '#2196f3',
          },
     }));

     // --- 2. 이동평균선 계산 ---
     const closingPrices = data.map((item) => Number(item[4]));

     const calculateMA = (period) => {
          const result = SMA.calculate({ period, values: closingPrices });
          const padding = Array(closingPrices.length - result.length).fill('-'); // ECharts는 null 대신 '-'를 사용 가능
          return padding.concat(result.map((val) => val.toFixed(2)));
     };

     const ma5 = calculateMA(5);
     const ma20 = calculateMA(20);
     const ma60 = calculateMA(60);
     const ma120 = calculateMA(120);

     // --- 3. ECharts 인스턴스 생성 및 옵션 설정 ---
     const canvas = createCanvas(1200, 800);
     const chart = echarts.init(canvas);

     const latestClose = ohlcData[ohlcData.length - 1][1];
     const prevClose =
          ohlcData.length > 1
               ? ohlcData[ohlcData.length - 2][1]
               : ohlcData[0][0];
     const change = latestClose - prevClose;
     const changePercent = prevClose === 0 ? 0 : (change / prevClose) * 100;
     const sign = change > 0 ? '▲' : '▼';
     const priceColor = change > 0 ? '#ef5350' : '#2196f3';

     const option = {
          backgroundColor: '#FFFFFF',
          title: {
               text: title,
               subtext: `${latestClose.toLocaleString()}  ${sign} ${Math.abs(
                    change
               ).toLocaleString()} (${changePercent.toFixed(2)}%)`,
               subtextStyle: { color: priceColor, fontSize: 18 },
               left: 'center',
               padding: [20, 0, 0, 0],
          },
          tooltip: {
               trigger: 'axis',
               axisPointer: { type: 'cross' },
          },
          legend: {
               data: ['MA5', 'MA20', 'MA60', 'MA120'],
               top: '10%',
          },
          grid: [
               { left: '10%', right: '8%', top: '15%', height: '55%' }, // 캔들차트 Grid
               { left: '10%', right: '8%', top: '75%', height: '15%' }, // 거래량차트 Grid
          ],
          xAxis: [
               {
                    type: 'category',
                    data: dates,
                    scale: true,
                    boundaryGap: false,
                    axisLine: { onZero: false },
                    splitLine: { show: false },
                    axisLabel: { show: false },
               },
               {
                    type: 'category',
                    gridIndex: 1,
                    data: dates,
                    scale: true,
                    boundaryGap: false,
                    axisLine: { onZero: false },
               },
          ],
          yAxis: [
               { scale: true, splitArea: { show: true } },
               {
                    scale: true,
                    gridIndex: 1,
                    axisLabel: { show: false },
                    axisTick: { show: false },
                    axisLine: { show: false },
               },
          ],
          series: [
               // 캔들차트
               {
                    type: 'candlestick',
                    name: '주가',
                    data: ohlcData,
                    itemStyle: {
                         color: '#ef5350', // 양봉
                         color0: '#2196f3', // 음봉
                         borderColor: '#ef5350',
                         borderColor0: '#2196f3',
                    },
               },
               // 거래량
               {
                    type: 'bar',
                    name: '거래량',
                    data: volumeData,
                    xAxisIndex: 1,
                    yAxisIndex: 1,
               },
               // 이동평균선
               {
                    type: 'line',
                    name: 'MA5',
                    data: ma5,
                    smooth: true,
                    showSymbol: false,
                    color: '#4caf50',
                    lineStyle: { width: 1.5 },
               },
               {
                    type: 'line',
                    name: 'MA20',
                    data: ma20,
                    smooth: true,
                    showSymbol: false,
                    color: '#ff9800',
                    lineStyle: { width: 1.5 },
               },
               {
                    type: 'line',
                    name: 'MA60',
                    data: ma60,
                    smooth: true,
                    showSymbol: false,
                    color: '#9c27b0',
                    lineStyle: { width: 1.5 },
               },
               {
                    type: 'line',
                    name: 'MA120',
                    data: ma120,
                    smooth: true,
                    showSymbol: false,
                    color: '#795548',
                    lineStyle: { width: 1.5 },
               },
          ],
     };

     chart.setOption(option);

     // --- 4. 이미지를 Buffer로 변환 후 Blob으로 생성 ---
     const buffer = canvas.toBuffer('image/png');
     // 5-1. Buffer로부터 Blob 객체를 생성합니다.
     const imageBlob = new Blob([buffer], { type: 'image/png' });

     // 5-2. (호환성을 위해) Blob 객체에 `_buffer` 속성으로 원본 Buffer를 추가합니다.
     // TypeScript에서는 에러가 날 수 있지만, JavaScript에서는 동적으로 속성 추가가 가능합니다.
     imageBlob._buffer = buffer;

     // 5-3. 생성된 Blob 객체를 배열에 담아 반환합니다.
     return imageBlob;
}

/**
 * [신규] 밴드 차트 데이터를 이용해 PER/PBR 밴드 차트를 생성합니다.
 */
/**
 * Apache ECharts를 사용하여 PER/PBR 밴드 차트 이미지를 생성하는 함수
 * @param {Array<Array<string|Date|number|null>>} data - 밴드 차트 데이터
 * @param {string} title - 차트 제목 (예: '종목명 PER Band')
 * @returns {Promise<Array<Blob & {_buffer?: Buffer}>|null>} - 생성된 차트 이미지를 담은 Blob 배열 또는 실패 시 null
 */
async function createBandChart(data, title) {
     try {
          const header = data[0];
          const rows = data.slice(1);

          // --- 1. 데이터 가공 (ECharts 형식에 맞게) ---
          const labels = rows.map((row) => {
               const d = new Date(row[0]);
               // ECharts는 'YYYY-MM-DD' 형식을 잘 인식합니다.
               return `${d.getFullYear()}-${('0' + (d.getMonth() + 1)).slice(
                    -2
               )}-${('0' + d.getDate()).slice(-2)}`;
          });

          // 각 시리즈(수정주가, 밴드1, 밴드2...)의 스타일 정의
          const seriesStyles = [
               { color: '#0057FF', width: 2.5, name: header[1] }, // 수정주가
               { color: '#D32F2F', width: 1.5, name: header[2] }, // 밴드 1
               { color: '#7CB342', width: 1.5, name: header[3] }, // 밴드 2
               { color: '#8E24AA', width: 1.5, name: header[4] }, // 밴드 3
               { color: '#FB8C00', width: 1.5, name: header[5] }, // 밴드 4
          ];

          // ECharts의 series 데이터 구조 생성
          const series = seriesStyles.map((style, index) => ({
               name: style.name,
               type: 'line',
               data: rows.map((row) =>
                    row[index + 1] === null ? '-' : row[index + 1]
               ), // null 값을 '-'로 변환
               smooth: true,
               showSymbol: false,
               color: style.color,
               lineStyle: {
                    width: style.width,
               },
          }));

          // --- 2. ECharts 인스턴스 생성 및 옵션 설정 ---
          const canvas = createCanvas(600, 450); // Chart.js와 동일한 사이즈
          const chart = echarts.init(canvas);

          const option = {
               backgroundColor: '#FFFFFF',
               title: {
                    text: title,
                    left: 'center',
                    textStyle: {
                         fontSize: 16,
                         fontWeight: 'bold',
                    },
               },
               tooltip: {
                    trigger: 'axis',
               },
               legend: {
                    data: series.map((s) => s.name),
                    bottom: 10,
                    textStyle: { fontSize: 10 },
               },
               grid: {
                    left: '10%',
                    right: '10%',
                    top: '15%',
                    bottom: '20%', // 범례 공간 확보
               },
               xAxis: {
                    type: 'category',
                    data: labels,
                    axisLabel: {
                         fontSize: 10,
                         // 레이블이 너무 많으면 자동으로 간격을 조절하는 옵션
                         interval: 'auto',
                         rotate: 0,
                    },
               },
               yAxis: {
                    type: 'value',
                    scale: true, // 0에서 시작하지 않도록 함
                    axisLabel: {
                         fontSize: 10,
                         formatter: (value) => {
                              if (value >= 10000) return value / 10000 + '만';
                              if (value >= 1000) return value / 1000 + '천';
                              return value;
                         },
                    },
               },
               series: series,
          };

          chart.setOption(option);

          // --- 3. 이미지를 Buffer로 변환 후 최종 반환값 가공 ---
          const buffer = canvas.toBuffer('image/png');
          const imageBlob = new Blob([buffer], { type: 'image/png' });
          imageBlob._buffer = buffer; // 호환성을 위한 _buffer 속성 추가

          return imageBlob;
     } catch (e) {
          // GAS 환경을 고려하여 Logger.log 사용 (만약 Node.js라면 console.error)

          console.error(`createBandChart 오류: ${e.message}`);
          return null;
     }
}

/**
 * Apache ECharts를 사용하여 컨센서스 시계열 차트 이미지를 생성하는 함수 (시계열 축 사용)
 * @param {Array<Array<Date|string|number>>} data - 컨센서스 시계열 데이터
 * @param {string} title - 차트 제목
 * @param {string} color - 라인 색상 (e.g., '#D32F2F')
 * @returns {Promise<Array<Blob & {_buffer?: Buffer}>|null>} - 생성된 차트 이미지를 담은 Blob 배열 또는 실패 시 null
 */
async function createConsensusLineChart(data, title, color) {
     try {
          const header = data[0];
          // [수정 1] 데이터를 더 이상 분리할 필요 없이, 헤더만 제거합니다.
          const rows = data.slice(1);

          // --- 2. ECharts 인스턴스 생성 및 옵션 설정 ---
          const canvas = createCanvas(700, 500);
          const chart = echarts.init(canvas);

          const option = {
               backgroundColor: '#FFFFFF',
               title: {
                    text: title,
                    left: 'center',
                    textStyle: { fontSize: 16, fontWeight: 'bold' },
               },
               tooltip: {
                    trigger: 'axis',
                    // 툴팁에 날짜 형식을 지정
                    axisPointer: {
                         animation: false,
                    },
               },
               legend: { show: false },
               grid: {
                    left: '12%',
                    right: '8%',
                    top: '15%',
                    bottom: '15%',
               },
               xAxis: {
                    // [수정 2] 축 타입을 'time'으로 변경합니다.
                    type: 'time',
                    axisLabel: {
                         fontSize: 10,
                         // 날짜 포맷을 지정할 수 있습니다.
                         formatter: '{yyyy}-{MM}-{dd}',
                    },
               },
               yAxis: {
                    type: 'value',
                    scale: true,
                    name: '(단위: 억원)',
                    nameLocation: 'middle',
                    nameGap: 50,
                    nameTextStyle: { fontSize: 12 },
                    axisLabel: {
                         fontSize: 10,
                         formatter: (value) => {
                              if (Math.abs(value) >= 1e9)
                                   return (value / 1e9).toFixed(1) + 'B';
                              if (Math.abs(value) >= 1e6)
                                   return (value / 1e6).toFixed(1) + 'M';
                              if (Math.abs(value) >= 1e3)
                                   return (value / 1e3).toFixed(1) + 'K';
                              return value;
                         },
                    },
               },
               series: [
                    {
                         name: header[1],
                         type: 'line',
                         // [수정 3] 가공되지 않은 [날짜, 값] 쌍 배열을 그대로 전달합니다.
                         data: rows,
                         color: color,
                         showSymbol: false,
                         smooth: true,
                         lineStyle: { width: 2.5 },
                    },
               ],
          };

          chart.setOption(option);

          // --- 3. 이미지를 Buffer로 변환 후 최종 반환값 가공 ---
          const buffer = canvas.toBuffer('image/png');
          const imageBlob = new Blob([buffer], { type: 'image/png' });
          imageBlob._buffer = buffer;

          return imageBlob;
     } catch (e) {
          console.error(`createConsensusLineChart 오류: ${e.message}`);
          return null;
     }
}

// ====================================================================
// ==================== 기존 헬퍼 함수들 (변경 없음) =====================
// ====================================================================
// fetchStockData, fetchBandChartData, parseBandDataForGoogleCharts,
// fetchConsensusData, getCompaniesCache, getCompanyInfoByCode, test 함수는
// 이전과 동일하므로 여기에 다시 포함하지 않았습니다. 기존 코드를 그대로 두세요.
// (만약 필요하시면 다시 요청해주세요)

async function fetchStockData(symbol, startTime, endTime) {
     const url = `https://m.stock.naver.com/front-api/external/chart/domestic/info?symbol=${symbol}&requestType=1&startTime=${startTime}&endTime=${endTime}&timeframe=day`;
     const headers = {
          'User-Agent':
               'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36',
          Referer: `https://finance.naver.com/item/fchart.naver?code=${symbol}`,
     };
     try {
          const response = await axios.get(url, { headers });
          const parsableText =
               typeof response.data === 'string'
                    ? response.data.replace(/'/g, '"')
                    : JSON.stringify(response.data).replace(/'/g, '"');
          const stockData = JSON.parse(parsableText);
          if (!Array.isArray(stockData)) return null;
          const header = [
               '날짜',
               '시가',
               '고가',
               '저가',
               '종가',
               '거래량',
               '외국인소진율',
          ];
          // stockData.unshift(header);
          return stockData;
     } catch (e) {
          Logger.log(`데이터 수집 오류: ${e.toString()}`);
          return null;
     }
}
async function fetchBandChartData(symbol) {
     const url = `https://navercomp.wisereport.co.kr/common/BandChart3.aspx?cmp_cd=${symbol}&gubun=0`;
     try {
          const response = await axios.get(url);
          return response.data;
     } catch (e) {
          Logger.log(`fetchBandChartData 오류: ${e.toString()}`);
          return null;
     }
}
function parseBandDataForGoogleCharts(chartData) {
     if (!chartData || !chartData.price) return null;
     const header = [
          '날짜',
          '수정주가',
          chartData.name.VAL4,
          chartData.name.VAL3,
          chartData.name.VAL2,
          chartData.name.VAL1,
     ];
     const dataTableRows = [header];
     for (let i = 0; i < chartData.price.length; i++) {
          if (chartData.price[i].y === null) continue;
          const date = new Date(chartData.price[i].x);
          const row = [
               date,
               chartData.price[i].y,
               chartData.val4[i].y,
               chartData.val3[i].y,
               chartData.val2[i].y,
               chartData.val1[i].y,
          ];
          dataTableRows.push(row);
     }
     return dataTableRows.length > 1 ? dataTableRows : null;
}
async function fetchConsensusData(companyId, year) {
     const url = `http://stockinu.com:4000/api/consensus?year=${year}&company_id=${companyId}`;
     try {
          const response = await axios.get(url);
          return response.data;
     } catch (e) {
          Logger.log(`fetchConsensusData 오류: ${e.toString()}`);
          return null;
     }
}
async function getCompaniesCache() {
     const cache = CacheService.getScriptCache();
     const CHUNK_PREFIX = 'COMPANIES_CHUNK_V3_';
     const CHUNK_COUNT_KEY = 'COMPANIES_CHUNK_COUNT_V3';
     const CHUNK_SIZE = 800;
     const chunkCountStr = cache.get(CHUNK_COUNT_KEY);
     if (chunkCountStr) {
          const chunkCount = parseInt(chunkCountStr, 10);
          const chunkKeys = Array.from(
               { length: chunkCount },
               (_, i) => CHUNK_PREFIX + i
          );
          const cachedChunks = cache.getAll(chunkKeys);
          let companiesArray = [];
          Object.values(cachedChunks).forEach((chunkJSON) => {
               companiesArray = companiesArray.concat(JSON.parse(chunkJSON));
          });
          return companiesArray;
     }
     try {
          const response = await axios.get(
               'http://stockinu.com:4000/api/company'
          );
          const essentialData = response.data.map((c) => ({
               id: c.id,
               code: c.code,
               name: c.name,
          }));
          const chunksToCache = {};
          let chunkCount = 0;
          for (let i = 0; i < essentialData.length; i += CHUNK_SIZE) {
               const chunk = essentialData.slice(i, i + CHUNK_SIZE);
               chunksToCache[CHUNK_PREFIX + chunkCount] = JSON.stringify(chunk);
               chunkCount++;
          }
          chunksToCache[CHUNK_COUNT_KEY] = String(chunkCount);
          cache.putAll(chunksToCache, 21600);
          return essentialData;
     } catch (e) {
          Logger.log(`Company API 호출 오류: ${e.toString()}`);
          return null;
     }
}
async function getCompanyInfoByCode(code) {
     const companies = await getCompaniesCache();
     if (!companies) return null;
     return companies.find((c) => c.code === code) || null;
}
async function test() {
     const result = await generatePerPbrBandCharts('005930');
     if (result && result.perChart && result.pbrChart) {
          await sendTelegramMediaGroup(
               [result.perChart, result.pbrChart],
               'PER/PBR 밴드 차트 테스트 (chart.js)'
          );
     } else {
          Logger.log('밴드 차트 생성 실패');
     }
}

module.exports = {
     generateStockChartImage,
     generatePerPbrBandCharts,
     generateConsensusCharts,
     test,
};
