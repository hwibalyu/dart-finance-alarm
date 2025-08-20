const axios = require('axios');
const { xml2js } = require('xml-js');
const Cheerio = require('cheerio');
const NodeCache = require('node-cache');
const { formatInTimeZone } = require('date-fns-tz');
require('dotenv').config();

// Logger.log -> console.log
const Logger = {
     log: (message) => {
          console.log(message);
     },
};

// Utilities.sleep, Utilities.formatDate
const Utilities = {
     sleep: (milliseconds) =>
          new Promise((resolve) => setTimeout(resolve, milliseconds)),
     formatDate: (date, timeZone, formatStr) => {
          const gasToDateFns = {
               yyyyMMdd: 'yyyyMMdd',
          };
          return formatInTimeZone(
               date,
               timeZone,
               gasToDateFns[formatStr] || formatStr
          );
     },
};

// PropertiesService
const PropertiesService = {
     getScriptProperties: () => ({
          getProperty: (key) => process.env[key],
     }),
};

// CacheService
const scriptCache = new NodeCache();
const CacheService = {
     getScriptCache: () => ({
          get: (key) => scriptCache.get(key) || null,
          getAll: (keys) => {
               const result = {};
               keys.forEach((key) => {
                    const value = scriptCache.get(key);
                    if (value) {
                         result[key] = value;
                    }
               });
               return result;
          },
          putAll: (values, expirationInSeconds) => {
               const success = [];
               for (const key in values) {
                    if (
                         scriptCache.set(key, values[key], expirationInSeconds)
                    ) {
                         success.push(key);
                    }
               }
               return success.length > 0;
          },
     }),
};

// UrlFetchApp.fetch
const UrlFetchApp = {
     fetch: async (url, params = {}) => {
          try {
               const config = {
                    method: params.method || 'get',
                    headers: params.headers || {},
                    responseType: 'arraybuffer', // Blob 처리를 위해 기본으로 arraybuffer 사용
                    validateStatus: () => true, // 모든 http 상태 코드를 에러 없이 받음 (muteHttpExceptions: true)
               };

               if (params.payload) {
                    // Telegram media group payload는 FormData 객체
                    if (params.payload.constructor.name === 'FormData') {
                         config.data = params.payload;
                         Object.assign(
                              config.headers,
                              params.payload.getHeaders()
                         );
                    } else if (params.contentType === 'application/json') {
                         config.data = params.payload;
                    } else {
                         config.data = params.payload;
                    }
               }

               const response = await axios(url, config);

               return {
                    getResponseCode: () => response.status,
                    getContentText: (charset = 'utf-8') => {
                         // iconv-lite 같은 라이브러리를 추가하면 더 많은 인코딩을 지원할 수 있으나,
                         // EUC-KR 정도는 Buffer 기본 기능으로 어느 정도 커버 가능합니다.
                         if (charset.toLowerCase() === 'euc-kr') {
                              return require('iconv-lite').decode(
                                   Buffer.from(response.data),
                                   'euc-kr'
                              );
                         }
                         if (charset.toLowerCase() === 'iso-8859-1') {
                              return require('iconv-lite').decode(
                                   Buffer.from(response.data),
                                   'latin1'
                              );
                         }
                         return Buffer.from(response.data).toString('utf-8');
                    },
                    getBlob: () => {
                         // axios의 arraybuffer 응답을 Buffer 객체로 변환하여 Blob처럼 사용합니다.
                         const buffer = Buffer.from(response.data);
                         // GAS의 Blob과 유사한 인터페이스를 흉내냅니다.
                         return {
                              getBytes: () => buffer,
                              setName: (name) => {
                                   buffer.name = name;
                                   return buffer;
                              },
                              // form-data 라이브러리에서 사용할 수 있도록 Buffer 자체를 반환
                              _buffer: buffer,
                         };
                    },
               };
          } catch (e) {
               if (params.muteHttpExceptions) {
                    return {
                         getResponseCode: () =>
                              e.response ? e.response.status : 500,
                         getContentText: () => e.message,
                         getBlob: () => null,
                    };
               }
               throw e;
          }
     },
};

// XmlService.parse
const XmlService = {
     parse: (xmlText) => {
          const jsObject = xml2js(xmlText, { compact: false });
          // GAS의 XML 인터페이스를 모방하는 객체를 반환합니다.
          const findElement = (elements, name) =>
               elements.find((el) => el.name === name);

          const createElement = (element) => {
               if (!element) return null;
               return {
                    getChild: (name) => {
                         return createElement(
                              findElement(element.elements || [], name)
                         );
                    },
                    getAttribute: (name) => ({
                         getValue: () =>
                              element.attributes
                                   ? element.attributes[name]
                                   : null,
                    }),
               };
          };

          return {
               getRootElement: () => createElement(jsObject.elements[0]),
          };
     },
};

// Charts Service (QuickChart.io를 이용한 대체 구현)
// GAS의 Charts 서비스는 서버에서 이미지를 생성합니다. Node.js에서는 외부 서비스나 라이브러리를 사용해야 합니다.
// 기존 코드에 QuickChart를 사용하는 부분이 있으므로, Google Charts 부분도 QuickChart로 대체하여 일관성을 유지합니다.
const Charts = {
     newDataTable: () => {
          const columns = [];
          const rows = [];
          return {
               addColumn: (_, name) => columns.push(name),
               addRow: (row) => rows.push(row),
               _getData: () => ({ columns, rows }),
          };
     },
     newLineChart: () => {
          let dataTable;
          const options = {
               title: '',
               dimensions: { width: 400, height: 300 },
               legendPosition: 'bottom',
               series: {},
               hAxis: {},
               vAxis: {},
               chartArea: {},
               colors: [],
          };

          const chartBuilder = {
               // 'this' 대신 명시적인 빌더 객체를 사용합니다.
               setDataTable: (table) => {
                    dataTable = table;
                    return chartBuilder; // 체이닝을 위해 빌더 객체 자신을 반환합니다.
               },
               setTitle: (title) => {
                    options.title = title;
                    return chartBuilder;
               },
               setDimensions: (w, h) => {
                    options.dimensions = { width: w, height: h };
                    return chartBuilder;
               },
               setLegendPosition: (pos) => {
                    options.legendPosition = pos;
                    return chartBuilder;
               },
               setOption: (key, value) => {
                    if (key === 'series') options.series = value;
                    else if (key === 'hAxis') options.hAxis = value;
                    else if (key === 'vAxis') options.vAxis = value;
                    else if (key === 'chartArea') options.chartArea = value;
                    else if (key === 'colors') options.colors = value;
                    else if (key === 'titleTextStyle')
                         options.titleTextStyle = value;
                    else if (key === 'legendTextStyle')
                         options.legendTextStyle = value;
                    return chartBuilder;
               },
               build: () => ({
                    getAs: async (mimeType) => {
                         if (mimeType !== 'image/png')
                              throw new Error('Only image/png is supported');

                         const { columns, rows } = dataTable._getData();

                         // 날짜 형식의 레이블을 yyyy-MM-dd 로 변환
                         const labels = rows.map((r) => {
                              if (r[0] instanceof Date) {
                                   return r[0].toISOString().split('T')[0];
                              }
                              return r[0];
                         });

                         // QuickChart.io에 보낼 데이터셋 구성
                         const datasets = columns.slice(1).map((colName, i) => {
                              const seriesOptions = options.series[i] || {};
                              return {
                                   label: colName,
                                   data: rows.map((r) => r[i + 1]),
                                   fill: false,
                                   borderColor:
                                        seriesOptions.color ||
                                        (options.colors && options.colors[i]) ||
                                        '#0000FF',
                                   borderWidth: seriesOptions.lineWidth || 2,
                                   yAxisID: 'y',
                              };
                         });

                         // QuickChart.io 구성 객체
                         const chartConfig = {
                              type: 'line',
                              data: {
                                   labels: labels,
                                   datasets: datasets,
                              },
                              options: {
                                   responsive: true,
                                   title: {
                                        display: true,
                                        text: options.title,
                                        font: {
                                             size:
                                                  options.titleTextStyle
                                                       ?.fontSize || 12,
                                        },
                                   },
                                   legend: {
                                        position:
                                             options.legendPosition.toLowerCase(),
                                        display:
                                             options.legendPosition !==
                                             Charts.Position.NONE,
                                        labels: {
                                             font: {
                                                  size:
                                                       options.legendTextStyle
                                                            ?.fontSize || 10,
                                             },
                                        },
                                   },
                                   scales: {
                                        x: {
                                             ticks: {
                                                  callback: function (
                                                       value,
                                                       index
                                                  ) {
                                                       // x축 레이블 포맷팅 (예: yy/MM)
                                                       const label =
                                                            this.getLabelForValue(
                                                                 value
                                                            );
                                                       if (
                                                            typeof label ===
                                                                 'string' &&
                                                            label.match(
                                                                 /^\d{4}-\d{2}-\d{2}$/
                                                            )
                                                       ) {
                                                            const date =
                                                                 new Date(
                                                                      label
                                                                 );
                                                            return `${(
                                                                 date.getFullYear() +
                                                                 ''
                                                            ).slice(-2)}/${(
                                                                 '0' +
                                                                 (date.getMonth() +
                                                                      1)
                                                            ).slice(-2)}`;
                                                       }
                                                       return label;
                                                  },
                                             },
                                        },
                                        y: {
                                             ticks: {
                                                  callback: function (value) {
                                                       // y축 레이블 포맷팅 (예: 1000 -> 1k)
                                                       if (
                                                            Math.abs(value) >=
                                                            1000000000
                                                       )
                                                            return (
                                                                 value /
                                                                      1000000000 +
                                                                 'B'
                                                            );
                                                       if (
                                                            Math.abs(value) >=
                                                            1000000
                                                       )
                                                            return (
                                                                 value /
                                                                      1000000 +
                                                                 'M'
                                                            );
                                                       if (
                                                            Math.abs(value) >=
                                                            1000
                                                       )
                                                            return (
                                                                 value / 1000 +
                                                                 'k'
                                                            );
                                                       return value;
                                                  },
                                             },
                                        },
                                   },
                              },
                         };

                         const payload = {
                              chart: chartConfig,
                              width: options.dimensions.width,
                              height: options.dimensions.height,
                              devicePixelRatio: 2.0,
                              backgroundColor: 'white',
                         };

                         const quickChartUrl = 'https://quickchart.io/chart';
                         const response = await axios.post(
                              quickChartUrl,
                              payload,
                              { responseType: 'arraybuffer' }
                         );

                         if (response.status === 200) {
                              const buffer = Buffer.from(response.data);
                              return {
                                   getBytes: () => buffer,
                                   setName: (name) => {
                                        buffer.name = name;
                                        return buffer;
                                   },
                                   _buffer: buffer,
                              };
                         }
                         return null;
                    },
               }),
          };

          return chartBuilder; // 초기 호출 시 빌더 객체를 반환합니다.
     },
     Position: { TOP: 'top', BOTTOM: 'bottom', NONE: 'none' },
     ColumnType: { STRING: 'string', NUMBER: 'number', DATE: 'date' },
};

// 모든 호환성 객체를 내보냅니다.
module.exports = {
     Logger,
     Utilities,
     PropertiesService,
     CacheService,
     UrlFetchApp,
     XmlService,
     Cheerio,
     Charts,
};
