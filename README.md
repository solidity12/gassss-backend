# STABLE Chain DEX Data Collector

STABLE 체인 위의 Uniswap V2 호환 DEX에서 풀별 볼륨/거래/유동성 데이터를 수집하는 Node.js 백엔드입니다.

## 기능

- Swap 이벤트 수집 및 저장
- Sync 이벤트 수집 및 저장 (유동성 추적)
- 토큰별 가격 계산 (경로 기반)
- MySQL 데이터베이스 저장
- 중복 방지 (txHash, logIndex)

## 설치

```bash
npm install
```

## 설정

`.env.example` 파일을 복사하여 `.env` 파일을 생성하고 필요한 설정을 입력하세요:

```bash
cp .env.example .env
```

필수 설정:
- `DB_HOST`: MySQL 호스트
- `DB_PORT`: MySQL 포트
- `DB_USER`: MySQL 사용자명
- `DB_PASSWORD`: MySQL 비밀번호
- `DB_NAME`: 데이터베이스 이름
- `RPC_URL`: STABLE 체인 RPC URL
- `FACTORY_ADDRESS`: Uniswap V2 Factory 컨트랙트 주소

## 데이터베이스 초기화

애플리케이션을 처음 실행하면 필요한 테이블이 자동으로 생성됩니다.

## 실행

```bash
npm start
```

개발 모드 (자동 재시작):

```bash
npm run dev
```

## 데이터베이스 스키마

### swaps 테이블
- `id`: 자동 증가 ID
- `txHash`: 트랜잭션 해시
- `logIndex`: 로그 인덱스
- `blockNumber`: 블록 번호
- `timestamp`: 타임스탬프
- `pairAddress`: 페어 주소
- `token0`: 토큰0 주소
- `token1`: 토큰1 주소
- `amount0In`: 토큰0 입력량
- `amount1In`: 토큰1 입력량
- `amount0Out`: 토큰0 출력량
- `amount1Out`: 토큰1 출력량
- `to`: 수신자 주소
- `price`: 계산된 가격
- `volume`: 거래 볼륨
- `createdAt`: 생성 시간

### syncs 테이블
- `id`: 자동 증가 ID
- `txHash`: 트랜잭션 해시
- `logIndex`: 로그 인덱스
- `blockNumber`: 블록 번호
- `timestamp`: 타임스탬프
- `pairAddress`: 페어 주소
- `token0`: 토큰0 주소
- `token1`: 토큰1 주소
- `reserve0`: 토큰0 리저브
- `reserve1`: 토큰1 리저브
- `liquidity`: 유동성 (sqrt(reserve0 * reserve1))
- `createdAt`: 생성 시간

## 주의사항

- 애플리케이션은 최신 블록부터 시작하여 과거 블록을 스캔합니다.
- `START_BLOCK` 환경 변수를 설정하면 특정 블록부터 시작할 수 있습니다.
- 중복 이벤트는 자동으로 무시됩니다.

