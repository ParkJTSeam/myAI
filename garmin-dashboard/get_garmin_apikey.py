"""
가민 APIKEY 발급 도우미 (내 PC에서 1회 실행)

  pip install garth
  python get_garmin_apikey.py

가민 계정으로 로그인(2단계 인증 지원)한 뒤, 구글 앱스크립트의
스크립트 속성 "APIKEY" 에 붙여넣을 JSON 한 줄을 출력합니다.
비밀번호는 저장/전송되지 않고, 출력되는 토큰은 약 1년간 유효합니다.
※ 출력된 값은 비밀번호와 같으니 다른 사람과 공유하지 마세요.
"""
import getpass
import json

import garth

email = input("가민 이메일: ").strip()
password = getpass.getpass("가민 비밀번호: ")

garth.login(email, password, prompt_mfa=lambda: input("2단계 인증 코드: ").strip())

t = garth.client.oauth1_token
apikey = {
    "oauth_token": t.oauth_token,
    "oauth_token_secret": t.oauth_token_secret,
    "mfa_token": t.mfa_token,
    "domain": t.domain,
}
print("\n✅ 아래 한 줄 전체를 복사해서 스크립트 속성 APIKEY 값으로 넣으세요:\n")
print(json.dumps(apikey, ensure_ascii=False))
