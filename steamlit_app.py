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
keywords = st.text_area('분석할 키워드를 입력하세요 (쉼표로 구분)', 'chatgpt, 인공지능')
keywords_to_bold = st.text_input("굵게 표시할 키워드 입력 (쉼표로 구분)", "")

# 키워드 분석 버튼 및 결과 표시
if st.button("키워드 분석 시작"):
    keyword_list = [kw.strip() for kw in keywords.split(',')]
    all_data = []
    
    for keyword in keyword_list:
        df = get_keyword_analysis(keyword)
        if not df.empty:
            all_data.append(df)

    if all_data:
        final_df = pd.concat(all_data, ignore_index=True)
        st.subheader("키워드 분석 결과")
        st.dataframe(final_df)

        # HTML 테이블 생성
        html_table = final_df.to_html(index=False, escape=False)
        
        # HTML 코드에 Google 광고 및 클릭 버튼 추가
        ads_code = adsense_codes["구라다"]  # 원하는 광고 코드로 변경
        button_code = create_glowing_button("더 알아보기", "#")
        
        # 최종 HTML 출력
        final_html = f"""
        <h2>키워드 분석 결과 요약</h2>
        {html_table}
        <h3>광고</h3>
        {ads_code}
        <h3>행동 버튼</h3>
        {button_code}
        """
        
        st.markdown(final_html, unsafe_allow_html=True)
    else:
        st.warning("선택한 키워드에 대한 데이터가 없습니다.")

# 원본 텍스트 표시
st.subheader("원본 블로그 글")
st.write(input_text)

# HTML 표와 광고를 원본 텍스트 아래에 표시
if input_text:
    st.markdown("<h2>아래는 HTML 테이블 및 광고</h2>", unsafe_allow_html=True)
    st.markdown(final_html, unsafe_allow_html=True)
