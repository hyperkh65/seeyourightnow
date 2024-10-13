import streamlit as st
import pandas as pd
import requests
import re
import time
import hmac
import hashlib
import base64
import pyperclip

# 페이지 레이아웃을 넓게 설정
st.set_page_config(layout="wide", page_title="블로그 작성 도우미")

# st.secrets에서 API 키 불러오기
CUSTOMER_ID = st.secrets["general"]["CUSTOMER_ID"]
API_KEY = st.secrets["general"]["API_KEY"]
SECRET_KEY = st.secrets["general"]["SECRET_KEY"]
client_id = st.secrets["general"]["client_id"]
client_secret = st.secrets["general"]["client_secret"]

# Constants
BASE_URL = "https://api.naver.com"

# 키워드 분석 관련 함수
class Signature:
    @staticmethod
    def generate(timestamp, method, uri, secret_key):
        message = f"{timestamp}.{method}.{uri}"
        secret_key_bytes = bytes(secret_key, 'utf-8')
        message_bytes = bytes(message, 'utf-8')
        sign = hmac.new(secret_key_bytes, message_bytes, hashlib.sha256).digest()
        signature = base64.b64encode(sign).decode('utf-8')
        return signature

def get_request_header(method, uri):
    timestamp = str(round(time.time() * 1000))
    signature = Signature.generate(timestamp, method, uri, SECRET_KEY)
    return {
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Timestamp': timestamp,
        'X-API-KEY': API_KEY,
        'X-Customer': str(CUSTOMER_ID),
        'X-Signature': signature
    }

@st.cache_data
def get_keyword_analysis(keyword):
    uri = '/keywordstool'
    method = 'GET'
    try:
        r = requests.get(
            BASE_URL + uri,
            params={'hintKeywords': keyword, 'showDetail': 1},
            headers=get_request_header(method, uri)
        )
        r.raise_for_status()
        data = r.json()
        
        if 'keywordList' not in data:
            st.error(f"API 응답에 'keywordList'가 없습니다. 응답: {data}")
            return pd.DataFrame()
        
        df = pd.DataFrame(data['keywordList'])
        if df.empty:
            st.warning(f"'{keyword}'에 대한 키워드 데이터가 없습니다.")
            return df
        
        # 데이터 처리 부분을 try-except로 감싸 오류 처리
        try:
            df['monthlyMobileQcCnt'] = df['monthlyMobileQcCnt'].apply(lambda x: int(str(x).replace('<', '').strip()))
            df['monthlyPcQcCnt'] = df['monthlyPcQcCnt'].apply(lambda x: int(str(x).replace('<', '').strip()))
            df = df[(df['monthlyMobileQcCnt'] >= 50) & (df['monthlyPcQcCnt'] >= 50)]
            df.rename(
                {'compIdx': '경쟁정도',
                'monthlyMobileQcCnt': '월간검색수_모바일',
                'monthlyPcQcCnt': '월간검색수_PC',
                'relKeyword': '연관키워드'},
                axis=1,
                inplace=True
            )
            df['총검색수'] = df['월간검색수_PC'] + df['월간검색수_모바일']
            df = df.sort_values('총검색수', ascending=False)
        except Exception as e:
            st.error(f"데이터 처리 중 오류 발생: {e}")
            return pd.DataFrame()
        
        return df
    except requests.RequestException as e:
        st.error(f"API 요청 중 오류 발생: {e}")
        return pd.DataFrame()
    except Exception as e:
        st.error(f"예상치 못한 오류 발생: {e}")
        return pd.DataFrame()

# 구글 애드센스 코드
adsense_codes = {
    "구라다": """<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-8940400388075870" crossorigin="anonymous"></script>
<!-- 구라다 -->
<ins class="adsbygoogle"
     style="display:block"
     data-ad-client="ca-pub-8940400388075870"
     data-ad-slot="5882156375"
     data-ad-format="auto"
     data-full-width-responsive="true"></ins>
<script>
     (adsbygoogle = window.adsbygoogle || []).push({});
</script>""",
    "블로그스팟": """<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-8940400388075870" crossorigin="anonymous"></script>
<!-- 블로그스팟 -->
<ins class="adsbygoogle"
     style="display:block"
     data-ad-client="ca-pub-8940400388075870"
     data-ad-slot="9804410890"
     data-ad-format="auto"
     data-full-width-responsive="true"></ins>
<script>
     (adsbygoogle = window.adsbygoogle || []).push({});
</script>""",
    "미라클E": """<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-8940400388075870" crossorigin="anonymous"></script>
<!-- 미라클E -->
<ins class="adsbygoogle"
     style="display:block"
     data-ad-client="ca-pub-8940400388075870"
     data-ad-slot="7074519437"
     data-ad-format="auto"
     data-full-width-responsive="true"></ins>
<script>
     (adsbygoogle = window.adsbygoogle || []).push({});
</script>"""
}

# 반짝이는 버튼 HTML 생성 함수
def create_glowing_button(text, link):
    return f"""
<style>
.glow-on-hover {{
    width: 220px;
    height: 50px;
    border: none;
    outline: none;
    color: #fff;
    background: #111;
    cursor: pointer;
    position: relative;
    z-index: 0;
    border-radius: 10px;
}}
.glow-on-hover:before {{
    content: '';
    background: linear-gradient(45deg, #ff0000, #ff7300, #fffb00, #48ff00, #00ffd5, #002bff, #7a00ff, #ff00c8, #ff0000);
    position: absolute;
    top: -2px;
    left:-2px;
    background-size: 400%;
    z-index: -1;
    filter: blur(5px);
    width: calc(100% + 4px);
    height: calc(100% + 4px);
    animation: glowing 20s linear infinite;
    opacity: 0;
    transition: opacity .3s ease-in-out;
    border-radius: 10px;
}}
.glow-on-hover:active {{
    color: #000
}}
.glow-on-hover:active:after {{
    background: transparent;
}}
.glow-on-hover:hover:before {{
    opacity: 1;
}}
.glow-on-hover:after {{
    z-index: -1;
    content: '';
    position: absolute;
    width: 100%;
    height: 100%;
    background: #111;
    left: 0;
    top: 0;
    border-radius: 10px;
}}
@keyframes glowing {{
    0% {{ background-position: 0 0; }}
    50% {{ background-position: 400% 0; }}
    100% {{ background-position: 0 0; }}
}}
</style>
<a href="{link}" target="_blank">
    <button class="glow-on-hover" type="button">{text}</button>
</a>
"""

# 메인 레이아웃 설정
st.title('블로그 작성 도우미')

# 블로그 글 작성
st.subheader("블로그 글 작성")
text_format = st.radio("텍스트 형식 선택", ("HTML", "Markdown", "일반 텍스트"))
input_text = st.text_area("블로그 글을 작성하세요", height=300)

# 키워드 분석
keywords = st.text_area('분석할 키워드를 입력하세요 (쉼표로 구분)', 'chatgpt, 인공지능').split(',')
keywords_to_bold = st.text_input("굵게 표시할 키워드를 입력하세요 (쉼표로 구분)").split(',')

# 이모티콘 추가 버튼
emoji_list = [("😀", "😀"), ("😂", "😂"), ("😍", "😍"), ("👍", "👍"), ("🎉", "🎉")]
cols = st.columns(len(emoji_list))
for idx, (emoji, emoji_symbol) in enumerate(emoji_list):
    with cols[idx]:
        if st.button(emoji):
            input_text += emoji_symbol
            st.experimental_rerun()

# 키워드 강조 기능
if text_format == "HTML":
    for keyword in keywords_to_bold:
        keyword = keyword.strip()
        if keyword:
            input_text = re.sub(r'({})'.format(re.escape(keyword)), r'<strong>\1</strong>', input_text, flags=re.IGNORECASE)

# HTML 변환
final_html = f"""
<html>
<head>
    <meta charset="UTF-8">
    <title>블로그 글</title>
</head>
<body>
    <h1>블로그 글</h1>
    <div>{input_text}</div>
    <h2>구글 애드센스</h2>
    {''.join(adsense_codes.values())}
</body>
</html>
"""

# HTML 미리보기
st.subheader("HTML 미리보기")
st.markdown(final_html, unsafe_allow_html=True)

# 실제 페이지 미리보기
st.subheader("실제 페이지 보기")
st.components.v1.html(final_html, height=600)

# 애드센스 키 3개 추가 및 복사 버튼
st.subheader("애드센스 키")
for code_name, code in adsense_codes.items():
    col1, col2 = st.columns([5, 1])
    with col1:
        st.markdown(f"**{code_name}**")
        st.markdown(code, unsafe_allow_html=True)
    with col2:
        if st.button("복사", key=code_name):
            pyperclip.copy(code)
            st.success("복사되었습니다!")

# 버튼 생성기
st.subheader("버튼 생성기")
button_text = st.text_input("버튼 텍스트 입력")
button_link = st.text_input("버튼 링크 입력")
if st.button("버튼 생성"):
    glowing_button_html = create_glowing_button(button_text, button_link)
    st.markdown(glowing_button_html, unsafe_allow_html=True)

# 옵션 섹션
st.sidebar.title("옵션")
st.sidebar.subheader("검색어 통계 보기")
if st.sidebar.button("통계 확인"):
    if keywords:
        analysis_results = []
        for keyword in keywords:
            df = get_keyword_analysis(keyword.strip())
            if not df.empty:
                analysis_results.append(df)
        
        if analysis_results:
            combined_df = pd.concat(analysis_results, ignore_index=True)
            st.sidebar.write(combined_df)
        else:
            st.sidebar.write("분석 결과가 없습니다.")
    else:
        st.sidebar.write("키워드를 입력하세요.")
