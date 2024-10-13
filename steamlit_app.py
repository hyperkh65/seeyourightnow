import streamlit as st
import pandas as pd
import requests
import re
import time
import hmac
import hashlib
import base64

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

# H1을 H2로 변경하는 함수
def convert_h1_to_h2(text):
    # HTML: <h1> 태그를 <h2>로 변경
    text = re.sub(r'<h1[^>]*>(.*?)<\/h1>', r'<h2>\1</h2>', text, flags=re.IGNORECASE)
    # Markdown: # (H1) 을 ## (H2)로 변경
    text = re.sub(r'^# (.+)', r'## \1', text, flags=re.MULTILINE)
    return text

# Markdown -> HTML 변환 함수
def markdown_to_html(text):
    # Markdown을 HTML로 변환
    text = convert_h1_to_h2(text)  # H1은 H2로 변경
    text = re.sub(r'^## (.+)', r'<h2>\1</h2>', text, flags=re.MULTILINE)  # H2 변환
    text = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', text)  # Bold 처리
    return text.replace('\n', '<br>')  # 줄바꿈을 <br>로 변환

# HTML -> Markdown 변환 함수
def html_to_markdown(text):
    # HTML을 Markdown으로 변환
    text = convert_h1_to_h2(text)  # H1은 H2로 변경
    text = re.sub(r'<h2[^>]*>(.*?)<\/h2>', r'## \1', text, flags=re.IGNORECASE)  # H2 변환
    text = re.sub(r'<strong>(.*?)<\/strong>', r'**\1**', text, flags=re.IGNORECASE)  # Bold 처리
    return text.replace('<br>', '\n')  # <br> 태그를 줄바꿈으로 변환

# API 요청을 위한 서명 생성 클래스
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
@keyframes glowing {{
    0% {{ background-position: 0 0; }}
    50% {{ background-position: 400% 0; }}
    100% {{ background-position: 0 0; }}
}}
</style>
<a href="{link}" target="_blank"><button class="glow-on-hover" type="button">{text}</button></a>
"""

# 블로그 포맷 선택
format_options = ["HTML", "Markdown", "Plain Text"]
selected_format = st.selectbox("출력 형식을 선택하세요:", format_options)

# 텍스트 입력
st.write("### 블로그 글 작성")
text_input = st.text_area("내용을 입력하세요", height=300)

# 텍스트 변환 및 출력
if st.button("변환"):
    if selected_format == "HTML":
        output_text = markdown_to_html(text_input)
    elif selected_format == "Markdown":
        output_text = html_to_markdown(text_input)
    else:
        output_text = text_input  # Plain Text 선택 시 변환 없이 출력
    
    st.write(f"### 변환된 {selected_format} 텍스트")
    st.code(output_text, language=selected_format.lower())

