# NEBULA STRIKE — 3D Space Arcade

고전적 fixed-plane 아케이드 슈터(Galaga 스타일)를 현대적인 3D 그래픽으로 재해석한 웹 게임입니다.
Three.js **WebGPU** 렌더링 기반으로, 로우폴리 스타십 + 네온 발광 디테일 + 파티클 폭발 + 성운 배경을 결합해 60fps에서 쾌적하게 즐길 수 있습니다.

> **본 프로젝트는 전 과정이 "바이브코딩(Vibe Coding)"으로 개발되었습니다.** 아래 [개발 과정](#개발-과정-바이브코딩) 섹션을 참고하세요.

---

## 🚀 주요 특징

- **WebGPU 렌더링** — Three.js `WebGPURenderer` 사용, 미지원 브라우저에는 폴백 메시지 표시
- **웨이브 기반 전투** — 적 편대 스폰 → 클리어 → 다음 웨이브, 5웨이브마다 보스 등장
- **4종 적 기체 + 보스** — fighter / interceptor / heavy / elite 각기 다른 실루엣·행동 패턴, 3페이즈 보스전
- **콤보 시스템** — 연속 처치 시 점수 배율 최대 x10까지 상승
- **파워업** — WEAPON(무기 레벨) / RAPID(속사) / PIERCE(관통) / DRONE(드론) / SHIELD(방패)
- **대시 + 무적** — 순간 이동으로 회피, 피격 후 짧은 무적 깜빡임
- **객체 풀링** — 탄/파티클/파워업은 사전 할당 풀에서 재사용 (GC 스파이크 방지)
- **프로시저럴 사운드** — WebAudio 기반 효과음 (외부 에셋 없음)

## 🕹️ 조작법

| 키 | 기능 |
|---|---|
| `A` / `D` 또는 `←` / `→` | 좌우 이동 (가속도·마찰 기반 부드러운 움직임) |
| `Space` 또는 `J` | 발사 (보관 시 자동 화력) |
| `Shift` 또는 `K` | 대시 (무적 + 쿨다운 0.9초) |
| `P` 또는 `Esc` | 일시정지 / 재개 |

## ▶️ 실행 방법

**요구 사항:** Node.js 18+, WebGPU 지원 브라우저 (최신 **Chrome** 또는 **Edge**)

```powershell
# 1. 의존성 설치
npm install

# 2. 개발 서버 실행
npm run dev
```

Windows에서는 `start-dev.bat` 더블클릭으로도 시작할 수 있습니다.

```powershell
# 프로덕션 빌드
npm run build
npm run preview
```

### GitHub Pages 배포 (GitHub Actions)

`.github/workflows/deploy.yml`이 기본으로 포함되어 있어, **로컬 빌드 없이** `main`에 push만 하면 자동으로 빌드 → 배포됩니다.

1. GitHub 리포에서 **Settings → Pages → Source**를 **GitHub Actions**로 선택 (단 1회)
2. `git push` → Actions 탭에서 `Deploy to GitHub Pages` 워크플로우가 실행
3. 완료되면 `https://<계정>.github.io/3d-galaga/` 에 공개

> 리포를 다른 이름으로 바꾸면 `vite.config.js`의 `base` 값을 새 리포명으로 같이 바꿔야 합니다.

## 🧠 개발 과정 — 바이브코딩

이 프로젝트는 수동 코딩 없이 **AI와 대화하며 만드는 "바이브코딩"** 방식으로 개발되었습니다. 개발자는 아이디어·느낌·수정 지시를 자연어로 전달하고, AI 에이전트가 설계·구현·디버깅을 수행하는 패턴입니다.

### 개발 환경

| 항목 | 사양 |
|---|---|
| **GPU** | NVIDIA RTX 3090 × 2 (24GB VRAM each) |
| **LLM** | [Qwen3.8-27B Q8](https://huggingface.co) (8bit 양자화, 로컬 추론) |
| **추론 서버** | [LM Studio](https://lmstudio.ai) — 로컬 LLM 호스팅 (OpenAI 호환 API) |
| **IDE** | [VS Code](https://code.visualstudio.com) + GitHub Copilot **에이전트 모드** (LM Studio 로컬 모델 연동) |

### 아키텍처 개요

```
브라우저 (Chrome/Edge, WebGPU)
   │  Vite dev server HMR
   ▼
VS Code + GitHub Copilot 에이전트
   │  OpenAI 호환 API (localhost)
   ▼
LM Studio  ──  Qwen3.8-27B Q8
   │  24GB VRAM × 2 GPU 로컬 추론
   ▼
RTX 3090 × 2
```

- **로컬 추론**: API 비용 0원, 코드 저장소 외부 전파 없음, 오프라인 개발 가능
- **27B Q8 모델**: 두 RTX 3090의 VRAM에 안정적으로 로드되어 게임 로직·3D 그래픽 코드 수준에서도 일관된 품질
- **워크플로**: 기능 요구(자연어) → 에이전트가 파일 구조 설계·구현 → 브라우저에서 플레이 테스트 → 느낌 기반 피드백(예: *"기체 색상이 어둡다, 네온 느낌으로 밝게"*) → 즉각 반영, 이 루프를 반복

### 코드 구조

에이전트가 유지보수성을 위해 적용한 규칙:

- `src/config.js` — 매직 넘버 0개: 모든 밸런스·색상·카메라 파라미터를 한 파일에 집중 관리
- **엔티티 + 시스템 분리** — 엔티티(`entities/`)는 상태·모델, 시스템(`systems/`)은 로직
- **객체 풀링**(`core/Pool.js`) — 탄/파티클/파워업 사전 할당
- **스테이트 머신**(`core/GameState.js`) — BOOT → MENU → PLAYING ↔ PAUSED / WAVE_CLEAR / BOSS_INTRO / GAME_OVER
- **공유 지오메트리** — 전 기체가 동일한 기본 기하체를 재사용 (메시 수가 많아도 렌더링 부담 최소화)

## 📁 프로젝트 구조

```
3d-galaga/
├── index.html                # DOM 루트 (#game-root, #hud)
├── style.css                 # HUD 오버레이 스타일
├── vite.config.js
├── start-dev.bat             # Windows 개발 서버 스타터
└── src/
    ├── main.js               # 진입점: WebGPU 지원 검사 → Game 부트스트랩
    ├── config.js             # 전체 튜닝값 단일 소스 (밸런스·색상·보스)
    ├── core/
    │   ├── Game.js           # 게임 루프 + 시스템/엔티티 연결, 점수·콤보·웨이브
    │   ├── GameState.js      # 상태 머신
    │   ├── InputManager.js   # 키보드 입력 ("just pressed" 감지)
    │   ├── Pool.js           # 객체 풀
    │   └── Renderer.js       # WebGPU 렌더러 + 지원 검사
    ├── entities/
    │   ├── Player.js         # 플레이어 (이동·대시·무기 상태)
    │   ├── Enemy.js          # 4종 적 기체 (편대 비행·공습·엔진/코어 애니메이션)
    │   ├── Boss.js           # 3페이즈 보스
    │   ├── PowerUp.js        # 파워업 드롭
    │   ├── Projectile.js     # 탄 (공유 지오메트리 + 색상별 재사용)
    │   └── ShipBuilder.js    # 전 기체 3D 모델 빌더 (공유 지오메트리 프리미티브)
    ├── systems/
    │   ├── ProjectileSystem.js    # 탄 스폰/수명
    │   ├── CollisionSystem.js     # 충돌 판정 (스페어 기반)
    │   ├── WaveSystem.js          # 웨이브 구성·스폰 스케줄
    │   ├── EnemyAttackSystem.js   # 적 발사·공습(diving) 행동
    │   ├── ParticleSystem.js      # 폭발·잔해 파티클
    │   ├── StarFieldSystem.js     # 3D 별 배경 (패럴랙스·무한 비행)
    │   └── AudioSystem.js         # WebAudio 프로시저럴 사운드
    ├── effects/
    │   ├── CameraEffects.js       # 카메라 흔들림·조명
    │   └── ExplosionEffect.js     # 폭발 프리셋
    └── ui/
        ├── HUD.js                 # 채점판·보스바·무기 상태
        └── FloatingText.js        # +점수 팝업
```

## 🎮 게임 플레이

1. **웨이브 시작** — 적이 원근(Z축)에서 편대 형태로 진입하며 좌우를 오갑니다.
2. **사격** — 1레벨당 정면 평행 레이저 N발. 무기 레벨은 웨이브 진행·파워업으로 상승(최대 5).
3. **콤보** — 2.4초 안에 연속 처치할수록 배율 상승 (최대 x10). 피격 시 초기화.
4. **파워업** — 적 처치 시 22% 확률로 드롭.
5. **보스전** — 5웨이브마다. 3페이즈, 카메라 줌인, HP 스케일링(사이클당 +450), 사격 전 총구 충전 전조.
6. **대시** — Shift로 짧은 무적 이동을 이용해 적 탄을 회피.

## 🎨 밸런스 튜닝

모든 수치가 `src/config.js`에 모여 있어 밸런스 조정 시 다른 파일 수정이 필요 없습니다.

- `WEAPON` — 화력(발수·속도·손상·발사속도)
- `ENEMY` / `WAVE` — 적 체력·속도·웨이브 스케일링
- `BOSS` — 보스 HP·화력 간격
- `COLORS` — 기체·탄·배경 팔레트
- `CAMERA` — 시야각·위치·보스 줌

## ✅ 브라우저 요구 사항

WebGPU는 최신 **Chrome** 또는 **Edge**에서만 사용할 수 있습니다. 미지원 브라우저에서는 자동으로 폴백 화면이 표시됩니다:

> *"이 게임은 WebGPU를 지원하는 최신 Chrome 또는 Edge 브라우저가 필요합니다."*
