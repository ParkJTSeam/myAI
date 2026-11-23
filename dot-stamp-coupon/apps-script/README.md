# Apps Script 업로드용 파일

이 폴더의 파일만 Apps Script 프로젝트에 넣으면 됩니다. 파일 이름은 **아래와 똑같이** 만들어야 합니다.

| # | 편집기에서 만들 파일 | 종류 | 내용 |
|---|---|---|---|
| 1 | `Code` | 스크립트 (.gs) | 서버 코드 (기본 `Code.gs` 내용을 지우고 붙여넣기) |
| 2 | `Index` | HTML | 메인 화면 뼈대 |
| 3 | `Style` | HTML | 도트 스타일 CSS |
| 4 | `Sprites` | HTML | 도트 이미지 (도장·아이콘) |
| 5 | `Game` | HTML | 미니게임 |
| 6 | `App` | HTML | 화면 동작 스크립트 |
| 7 | `appsscript.json` | 설정 (선택) | 프로젝트 설정 → "appsscript.json 매니페스트 파일 표시" 체크 후 붙여넣기 |

- HTML 파일은 `+ → HTML` 로 만들고 이름에 `.html` 은 빼고 입력합니다. (예: `Index`)
- 한 번에 복사하고 싶으면 [`ALL_IN_ONE.txt`](ALL_IN_ONE.txt) 를 열어 구간별로 복사하세요.

## 순서
1. 구글 스프레드시트 → **확장 프로그램 → Apps Script**
2. 위 7개 파일 만들고 붙여넣기 → 저장
3. 함수 선택에서 `setup` 실행 → 권한 승인 (시트 7개 자동 생성)
4. **배포 → 새 배포 → 웹 앱** / 실행 사용자: 나 / 액세스: 모든 사용자
5. 받은 웹앱 URL 접속 · 관리자 기본값 `admin` / `1234` → `Admins` 시트에서 꼭 변경

## clasp 사용 시 (선택)
```bash
npm i -g @google/clasp && clasp login
cd apps-script && clasp create --type sheets --title "도트 운동 도장판"   # 또는 clasp clone <스크립트ID>
clasp push
```
