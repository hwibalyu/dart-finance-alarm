const { sendTelegramMediaGroup } = require('./helper');

const echarts = require('echarts');
const { createCanvas } = require('canvas');
const fs = require('fs');

/**
 * Apache ECharts를 사용하여 컨센서스 시계열 차트 이미지를 생성하는 함수 (시계열 축 사용)
 * @param {Array<Array<Date|string|number>>} data - 컨센서스 시계열 데이터
 * @param {string} title - 차트 제목
 * @param {string} color - 라인 색상 (e.g., '#D32F2F')
 * @returns {Promise<Array<Blob & {_buffer?: Buffer}>|null>} - 생성된 차트 이미지를 담은 Blob 배열 또는 실패 시 null
 */
async function createConsensusLineChart_ECharts(data, title, color) {
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
          console.error(`createConsensusLineChart_ECharts 오류: ${e.message}`);
          return null;
     }
}

// --- 함수 사용 예제 ---

// 제공해주신 데이터를 테스트용 변수로 가공
const opChartData = [
     ['날짜', '매출액'],
     [new Date('2023-04-04T00:00:00.000Z'), 79880],
     [new Date('2023-04-05T00:00:00.000Z'), 79880],
     [new Date('2023-04-06T00:00:00.000Z'), 79880],
     [new Date('2023-04-07T00:00:00.000Z'), 79880],
     [new Date('2023-04-08T00:00:00.000Z'), 79880],
     [new Date('2023-04-09T00:00:00.000Z'), 79880],
     [new Date('2023-04-10T00:00:00.000Z'), 79880],
     [new Date('2023-04-11T00:00:00.000Z'), 79880],
     [new Date('2023-04-12T00:00:00.000Z'), 79880],
     [new Date('2023-04-13T00:00:00.000Z'), 79880],
     [new Date('2023-04-14T00:00:00.000Z'), 79880],
     [new Date('2023-04-15T00:00:00.000Z'), 79880],
     [new Date('2023-04-16T00:00:00.000Z'), 79880],
     [new Date('2023-04-17T00:00:00.000Z'), 79880],
     [new Date('2023-04-18T00:00:00.000Z'), 79880],
     [new Date('2023-04-19T00:00:00.000Z'), 79880],
     [new Date('2023-04-20T00:00:00.000Z'), 79880],
     [new Date('2023-04-21T00:00:00.000Z'), 79880],
     [new Date('2023-04-22T00:00:00.000Z'), 79880],
     [new Date('2023-04-23T00:00:00.000Z'), 79880],
     [new Date('2023-04-24T00:00:00.000Z'), 79880],
     [new Date('2023-04-25T00:00:00.000Z'), 79880],
     [new Date('2023-04-26T00:00:00.000Z'), 79880],
     [new Date('2023-04-27T00:00:00.000Z'), 79880],
     [new Date('2023-04-28T00:00:00.000Z'), 79880],
     [new Date('2023-04-29T00:00:00.000Z'), 79880],
     [new Date('2023-04-30T00:00:00.000Z'), 79880],
     [new Date('2023-05-01T00:00:00.000Z'), 79880],
     [new Date('2023-05-02T00:00:00.000Z'), 79880],
     [new Date('2023-05-03T00:00:00.000Z'), 79880],
     [new Date('2023-05-04T00:00:00.000Z'), 79880],
     [new Date('2023-05-05T00:00:00.000Z'), 79880],
     [new Date('2023-05-06T00:00:00.000Z'), 79880],
     [new Date('2023-05-07T00:00:00.000Z'), 79880],
     [new Date('2023-05-08T00:00:00.000Z'), 79880],
     [new Date('2023-05-09T00:00:00.000Z'), 79880],
     [new Date('2023-05-10T00:00:00.000Z'), 79880],
     [new Date('2023-05-11T00:00:00.000Z'), 79360],
     [new Date('2023-05-12T00:00:00.000Z'), 79360],
     [new Date('2023-05-13T00:00:00.000Z'), 79360],
     [new Date('2023-05-14T00:00:00.000Z'), 79360],
     [new Date('2023-05-15T00:00:00.000Z'), 79360],
     [new Date('2023-05-16T00:00:00.000Z'), 79360],
     [new Date('2023-05-17T00:00:00.000Z'), 79360],
     [new Date('2023-05-18T00:00:00.000Z'), 79360],
     [new Date('2023-05-19T00:00:00.000Z'), 79360],
     [new Date('2023-05-20T00:00:00.000Z'), 79360],
     [new Date('2023-05-21T00:00:00.000Z'), 79360],
     [new Date('2023-05-22T00:00:00.000Z'), 79360],
     [new Date('2023-05-23T00:00:00.000Z'), 79360],
     [new Date('2023-05-24T00:00:00.000Z'), 79360],
     [new Date('2023-05-25T00:00:00.000Z'), 79360],
     [new Date('2023-05-26T00:00:00.000Z'), 79360],
     [new Date('2023-05-27T00:00:00.000Z'), 79360],
     [new Date('2023-05-28T00:00:00.000Z'), 79360],
     [new Date('2023-05-29T00:00:00.000Z'), 79360],
     [new Date('2023-05-30T00:00:00.000Z'), 79360],
     [new Date('2023-05-31T00:00:00.000Z'), 79360],
     [new Date('2023-06-01T00:00:00.000Z'), 79360],
     [new Date('2023-06-02T00:00:00.000Z'), 79360],
     [new Date('2023-06-03T00:00:00.000Z'), 79360],
     [new Date('2023-06-04T00:00:00.000Z'), 79360],
     [new Date('2023-06-05T00:00:00.000Z'), 79360],
     [new Date('2023-06-06T00:00:00.000Z'), 79360],
     [new Date('2023-06-07T00:00:00.000Z'), 79360],
     [new Date('2023-06-08T00:00:00.000Z'), 79360],
     [new Date('2023-06-09T00:00:00.000Z'), 79360],
     [new Date('2023-06-10T00:00:00.000Z'), 79360],
     [new Date('2023-06-11T00:00:00.000Z'), 79360],
     [new Date('2023-06-12T00:00:00.000Z'), 79360],
     [new Date('2023-06-13T00:00:00.000Z'), 79360],
     [new Date('2023-06-14T00:00:00.000Z'), 79360],
     [new Date('2023-06-15T00:00:00.000Z'), 79360],
     [new Date('2023-06-16T00:00:00.000Z'), 79360],
     [new Date('2023-06-17T00:00:00.000Z'), 79360],
     [new Date('2023-06-18T00:00:00.000Z'), 79360],
     [new Date('2023-06-19T00:00:00.000Z'), 79360],
     [new Date('2023-06-20T00:00:00.000Z'), 79360],
     [new Date('2023-06-21T00:00:00.000Z'), 79360],
     [new Date('2023-06-22T00:00:00.000Z'), 79360],
     [new Date('2023-06-23T00:00:00.000Z'), 79360],
     [new Date('2023-06-24T00:00:00.000Z'), 79360],
     [new Date('2023-06-25T00:00:00.000Z'), 79360],
     [new Date('2023-06-26T00:00:00.000Z'), 79360],
     [new Date('2023-06-27T00:00:00.000Z'), 79360],
     [new Date('2023-06-28T00:00:00.000Z'), 116950],
     [new Date('2023-06-29T00:00:00.000Z'), 116950],
     [new Date('2023-06-30T00:00:00.000Z'), 116950],
     [new Date('2023-07-01T00:00:00.000Z'), 116950],
     [new Date('2023-07-02T00:00:00.000Z'), 116950],
     [new Date('2023-07-03T00:00:00.000Z'), 116950],
     [new Date('2023-07-04T00:00:00.000Z'), 116950],
     [new Date('2023-07-05T00:00:00.000Z'), 116950],
     [new Date('2023-07-06T00:00:00.000Z'), 116950],
     [new Date('2023-07-07T00:00:00.000Z'), 116950],
     [new Date('2023-07-08T00:00:00.000Z'), 116950],
     [new Date('2023-07-09T00:00:00.000Z'), 116950],
     [new Date('2023-07-10T00:00:00.000Z'), 116950],
];

(async () => {
     const opChartBlob = await createConsensusLineChart_ECharts(
          [opChartData],
          '2025년 영업이익 컨센서스 추이',
          '#D32F2F'
     );

     sendTelegramMediaGroup([opChartBlob]);
})();
