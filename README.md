# DART Finance Alarm (DART 실적 공시 텔레그램 알림 봇)

**DART Finance Alarm**은 대한민국 금융감독원 전자공시시스템(DART)에 게시되는 기업의 실적 공시를 모니터링하고, 핵심 데이터를 추출 및 분석하여 다양한 시각 자료와 함께 텔레그램으로 자동 전송해주는 Node.js 기반의 자동화 봇입니다.

## 🚀 주요 기능

-    **DART 공시 모니터링**: DART API를 통해 최신 공시 목록을 확인하고, 이전에 분석한 공시 이후의 새로운 내용만 처리하여 중복 작업을 방지합니다. (`last_rcp.txt` 파일 기반)
-    **지능형 실적 공시 필터링**: 수많은 공시 중에서 '사업보고서', '분기/반기보고서', '영업(잠정)실적' 등 분석 가치가 있는 실적 관련 공시만을 자동으로 선별합니다.
-    **과거 실적 및 컨센서스 데이터 통합**: 최신 공시 실적과 함께 과거 분기 실적(Daum 증권), 시장 전망치(Naver 증권 컨센서스) 및 시가총액 정보를 자동으로 수집하여 종합적인 분석을 제공합니다.
-    **실적 중요도 자동 분석**: 최신 실적이 시장 기대치(컨센서스), 전년 동기(YoY), 직전 분기(QoQ) 대비 얼마나 의미 있는 변화를 보였는지 **중요도 점수**를 자동으로 계산하고, 점수가 높은(5점 이상) 공시만 선별하여 알림을 보낼 수 있습니다.
-    **다양한 보조 차트 자동 생성**: 투자 판단에 도움이 되는 보조 자료들을 서버에서 직접 이미지로 생성합니다.
     -    최근 1년 주가 캔들차트 (이동평균선 포함)
     -    PER/PBR 밴드 차트
     -    연간 매출액/영업이익 컨센서스 추이 차트
-    **텔레그램 알림**: 분석된 모든 정보를 가독성 높은 포맷으로 정리하고, 생성된 차트 이미지들과 함께 지정된 텔레그램 채널로 전송합니다.

## 📊 데이터 처리 흐름

```
[DART API] -> [1. 공시 목록 수집] -> [2. 실적 공시 필터링] -> [3. HTML/XML 파싱]
                                                                     |
                                                                     V
[4. 외부 데이터 수집] <-- (Naver/Daum 증권) -- [5. 데이터 통합 및 분석]
    - 과거 실적                                      - 5분기 실적 계산
    - 컨센서스                                     - 중요도 점수 산정
    - 시가총액                                     - PER/POR 지표 계산
       |
       V
[6. 차트 이미지 생성] -> [7. 텔레그램 메시지 포맷팅] -> [8. 텔레그램 전송]
```

## 🛠️ 기술 스택

-    **런타임**: Node.js
-    **HTTP 통신**: `axios`
-    **HTML/XML 파싱**: `cheerio`, `xml-js`
-    **차트 생성**: `echarts`, `canvas`
-    **환경 변수 관리**: `dotenv`

## ⚙️ 설치 및 설정

### 1. 사전 요구사항

-    Node.js (v18 이상 권장)
-    npm

### 2. 프로젝트 클론 및 의존성 설치

```bash
# 1. 프로젝트를 로컬에 복제합니다.
git clone https://your-repository-url/dart-finance-alarm.git

# 2. 프로젝트 디렉토리로 이동합니다.
cd dart-finance-alarm

# 3. package.json에 명시된 모든 의존성 패키지를 설치합니다.
npm install
```

### 3. 환경 변수 설정

프로젝트 루트 디렉토리에 `.env` 파일을 생성하고 아래 내용을 채워넣습니다. API 키와 토큰은 외부에 노출되지 않도록 주의하세요.

```ini
# .env 파일 예시

# DART API 인증키 (https://opendart.fss.or.kr/ 에서 발급)
DART_API_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# 텔레그램 봇 토큰 (BotFather를 통해 발급)
TELEGRAM_BOT_TOKEN=xxxxxxxxxx:xxxxxxxxxxxxxxxxxxxxxxxxxxx-xxxxxx

# 알림을 수신할 텔레그램 채널의 ID (@채널이름 또는 숫자 ID)
TELEGRAM_CHAT_ID=@your_channel_name
```

## ▶️ 실행 방법

프로젝트가 올바르게 설정되었는지 확인하기 위해 터미널에서 수동으로 스크립트를 실행할 수 있습니다.

```bash
node main.js
```

스크립트 실행 시 `main.js` 파일 하단의 `runFullProcessAndLogResults(true)` 인자를 통해 중요도 필터링 여부를 제어할 수 있습니다.

-    `true`: 매출 또는 영업이익 중요도가 5 이상인 공시만 텔레그램으로 전송합니다.
-    `false`: 분석에 성공한 모든 공시를 전송합니다.

## 📁 프로젝트 구조

````
dart-finance-alarm/
├── node_modules/
├── charts.js           # 차트 이미지 생성 로직
├── consensus.js        # Naver 증권 컨센서스 데이터 수집
├── financial.js        # Daum/Naver 과거 실적 및 시가총액 수집
├── gas-compatibility.js # Google Apps Script API 호환성 레이어
├── helper.js           # 텔레그램 메시지 포맷팅, 전송, 중요도 계산
├── main.js             # 메인 워크플로우 컨트롤러 (시작점)
├── quarter.js          # 최신 공시와 과거 실적 데이터 병합 및 계산
├── last_rcp.txt        # 마지막으로 처리한 공시 접수번호 (자동 생성/관리)
├── package.json
├── package-lock.json
└── README.md```

## 📄 라이선스

이 프로젝트는 [ISC](https://opensource.org/licenses/ISC) 라이선스를 따릅니다.
````
