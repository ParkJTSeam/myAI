"""apps-script/ 파일로 ALL_IN_ONE.txt 와 업로드용 zip 을 다시 만듭니다.  사용: python3 build.py"""
import os, zipfile
HERE = os.path.dirname(os.path.abspath(__file__))
D = os.path.join(HERE, 'apps-script')
ORDER = [('Code.gs', '스크립트(.gs)', '서버 코드 - 기본 Code.gs 내용을 모두 지우고 붙여넣기'),
         ('Index.html', 'HTML', '메인 화면 뼈대'), ('Style.html', 'HTML', '도트 스타일 CSS'),
         ('Sprites.html', 'HTML', '도트 이미지(도장·아이콘)'), ('Game.html', 'HTML', '미니게임'),
         ('App.html', 'HTML', '화면 동작 스크립트'),
         ('appsscript.json', '설정', '프로젝트 설정 → "appsscript.json 매니페스트 파일 표시" 체크 후 붙여넣기 (선택)')]
out = ['도트 운동 도장판 - Apps Script 전체 코드', '=' * 60, '', '[붙여넣는 방법]',
       'Apps Script 편집기 왼쪽 "파일 +" 로 아래 이름 그대로 만들고 각 구간 내용을 붙여넣으세요.',
       'HTML 파일은 이름 입력 시 ".html" 을 빼고 입력 (예: Index)', '']
out += [f'  {i}. {f:<16} [{t}] {d}' for i, (f, t, d) in enumerate(ORDER, 1)] + ['']
for i, (f, t, _) in enumerate(ORDER, 1):
    body = open(os.path.join(D, f), encoding='utf-8').read().rstrip()
    out += ['', '#' * 70, f'#  {i}. {f}   ({t})', '#  ▼ 아래 줄부터 "END OF" 줄 전까지 복사', '#' * 70, body,
            f'#################### END OF {f} ####################']
open(os.path.join(D, 'ALL_IN_ONE.txt'), 'w', encoding='utf-8').write('\n'.join(out) + '\n')
with zipfile.ZipFile(os.path.join(HERE, 'dot-stamp-coupon-apps-script.zip'), 'w', zipfile.ZIP_DEFLATED) as z:
    for f in [o[0] for o in ORDER] + ['ALL_IN_ONE.txt', 'README.md']:
        z.write(os.path.join(D, f), f)
print('ok')
