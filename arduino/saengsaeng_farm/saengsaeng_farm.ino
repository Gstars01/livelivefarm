/*
  생생팜 센서 → 블루투스 전송

  2초마다 아래 형식으로 한 줄을 보냄 (웹사이트가 이 형식을 읽음)
    soil=52,gas=640,sun=23000,pest=2

  보드: Arduino Uno / Nano
  블루투스 모듈: HC-05, HC-06, HM-10(BLE) 모두 같은 코드로 동작
    모듈 TXD → D2
    모듈 RXD → D3  (5V 보드라면 1kΩ/2kΩ 저항으로 전압을 낮춰 연결)
    VCC → 5V, GND → GND

  센서 (예시 배선)
    토양 수분 센서 AO  → A0
    가스 센서 MQ-135 AO → A1
    조도 센서(CdS) 분압 출력 → A2   (CdS — A2 — 10kΩ — GND, CdS 반대쪽은 5V)
    해충 감지 센서(적외선 장애물 / PIR) OUT → D4

  ※ 아래 *_RAW 값과 변환식은 대략적인 예시예요.
     시리얼 모니터에서 실제 원시값을 보고 꼭 보정해 주세요.
*/

#include <SoftwareSerial.h>

SoftwareSerial bt(2, 3);   // RX, TX

const int SOIL_PIN = A0;
const int GAS_PIN  = A1;
const int LIGHT_PIN = A2;
const int PEST_PIN = 4;

// 토양 수분 보정: 공기 중(완전 건조)과 물속(완전 젖음)에서 읽은 값
const int SOIL_DRY_RAW = 1023;
const int SOIL_WET_RAW = 300;

const unsigned long SEND_INTERVAL = 2000;   // 2초마다 전송

unsigned long lastSend = 0;
int pestCount = 0;          // 전원을 켠 뒤 감지한 해충 수
int lastPestState = LOW;

void setup() {
  Serial.begin(9600);       // USB 케이블로 볼 때
  bt.begin(9600);           // 블루투스 모듈 (HC-05/06, HM-10 기본 속도)
  pinMode(PEST_PIN, INPUT);
}

void loop() {
  // 해충 센서: LOW → HIGH 로 바뀔 때마다 1마리로 셈
  int pestState = digitalRead(PEST_PIN);
  if (pestState == HIGH && lastPestState == LOW) pestCount++;
  lastPestState = pestState;

  if (millis() - lastSend < SEND_INTERVAL) return;
  lastSend = millis();

  // 토양 수분 (%)
  int soilRaw = analogRead(SOIL_PIN);
  int soil = map(soilRaw, SOIL_DRY_RAW, SOIL_WET_RAW, 0, 100);
  soil = constrain(soil, 0, 100);

  // 가스 (ppm, 대략값) — MQ-135는 예열 후(수 분~하루) 보정이 필요해요
  int gasRaw = analogRead(GAS_PIN);
  long gas = map(gasRaw, 0, 1023, 300, 2000);

  // 조도 (lux, 대략값) — 정확한 값이 필요하면 BH1750 센서를 추천해요
  int lightRaw = analogRead(LIGHT_PIN);
  long sun = map(lightRaw, 0, 1023, 0, 60000);

  String line = "soil=" + String(soil) +
                ",gas=" + String(gas) +
                ",sun=" + String(sun) +
                ",pest=" + String(pestCount);

  bt.println(line);
  Serial.println(line);
}
