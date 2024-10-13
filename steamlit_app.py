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
    background: transparent;  /* 기본 배경을 투명으로 설정 */
    cursor: pointer;
    position: relative;
    z-index: 0;
    border-radius: 10px;
    overflow: hidden;  /* 내부 요소가 버튼 경계를 넘지 않도록 설정 */
}}
.glow-on-hover:before {{
    content: '';
    background: linear-gradient(45deg, red, orange, yellow, green, blue, indigo, violet);  /* 무지개 색상 그라디언트 */
    position: absolute;
    top: -2px;
    left: -2px;
    background-size: 400%;  /* 그라디언트를 더 크게 만들어 부드럽게 흐르게 함 */
    z-index: -1;
    filter: blur(5px);
    width: calc(100% + 4px);
    height: calc(100% + 4px);
    animation: glowing 4s linear infinite;  /* 애니메이션 속도 조절 */
    opacity: 0.8;  /* 약간의 투명도 추가 */
    transition: opacity .3s ease-in-out;
    border-radius: 10px;
}}
.glow-on-hover:active {{
    color: #000;
}}
.glow-on-hover:hover:before {{
    opacity: 1;  /* 마우스 오버 시 불투명도 증가 */
}}
.glow-on-hover:after {{
    z-index: -1;
    content: '';
    position: absolute;
    width: 100%;
    height: 100%;
    background: transparent;  /* 내부 배경을 투명으로 설정 */
    left: 0;
    top: 0;
    border-radius: 10px;
}}
@keyframes glowing {{
    0% {{ background-position: 0 0; }}
    50% {{ background-position: 100% 0; }}  /* 그라디언트가 부드럽게 이동 */
    100% {{ background-position: 0 0; }}
}}
</style>
<a href="{link}" target="_blank">
    <button class="glow-on-hover" type="button">{text}</button>
</a>
"""


# 메인 레이아웃 설정
st.title('블로그 작성 도우미')

# 구글 애드센스 코드 버튼
st.subheader("구글 애드센스 코드")
for name, code in adsense_codes.items():
    if st.button(f"{name} 광고 코드 복사"):
        st.code(code, language='html')
        st.success(f"{name} 광고 코드가 표시되었습니다. 복사하여 사용하세요.")

# 반짝이는 버튼 생성
st.subheader("반짝이는 버튼 생성")
button_text = st.text_input("버튼 텍스트 입력")
button_link = st.text_input("버튼 링크 입력")
if st.button("반짝이는 버튼 코드 생성"):
    button_code = create_glowing_button(button_text, button_link)
    st.code(button_code, language='html')
    st.success("반짝이는 버튼 코드가 생성되었습니다. 위의 코드를 복사하여 사용하세요.")
    st.markdown(button_code, unsafe_allow_html=True)

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
            input_text = re.sub(r'({})'.format(re.escape(keyword)), r'<strong>\1</strong>', input_text)
elif text_format == "Markdown":
    for keyword in keywords_to_bold:
        keyword = keyword.strip()
        if keyword:
            input_text = re.sub(r'({})'.format(re.escape(keyword)), r'**\1**', input_text)

# 작성된 글 미리보기
st.subheader("작성된 블로그 글 미리 보기:")
if text_format == "HTML":
    st.markdown(input_text, unsafe_allow_html=True)
elif text_format == "Markdown":
    st.markdown(input_text)
else:
    st.text(input_text)

# 키워드 분석 결과
st.subheader("키워드 분석 결과")
if st.button('분석 실행'):
    tmp_df = pd.DataFrame()
    with st.spinner('키워드 분석 중...'):
        for keyword in keywords:
            keyword = keyword.strip()
            if keyword:
                df = get_keyword_analysis(keyword)
                if not df.empty:
                    tmp_df = pd.concat([tmp_df, df], axis=0)
    if not tmp_df.empty:
        st.dataframe(tmp_df)
    else:
        st.warning("분석 결과가 없습니다. 키워드를 확인하고 다시 시도해 주세요.")
