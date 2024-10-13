import streamlit as st
import pandas as pd
import requests
import re
import time
import hmac
import hashlib
import base64
from PIL import Image, ImageDraw, ImageFont

# 페이지 레이아웃을 넓게 설정
st.set_page_config(layout="wide", page_title="블로그 작성 도우미")

# st.secrets에서 API 키 불러오기
CUSTOMER_ID = st.secrets["general"]["CUSTOMER_ID"]
API_KEY = st.secrets["general"]["API_KEY"]
SECRET_KEY = st.secrets["general"]["SECRET_KEY"]

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
    color: #fff;  /* 버튼 글자 색상 */
    background: red;  /* 배경 색상 빨간색 */
    cursor: pointer;
    position: relative;
    z-index: 0;
    border-radius: 10px;
    transition: transform 0.3s;  /* 마우스를 올렸을 때 부드럽게 확대하는 효과 */
    margin: 0 auto;  /* 버튼 가운데 정렬 */
    display: block;  /* 블록 요소로 설정하여 가운데 정렬 */
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
    animation: glowing 20s linear infinite;  /* 애니메이션 속도 조절 */
    opacity: 0.8;  /* 약간의 투명도 추가 */
    border-radius: 10px;
}}
.glow-on-hover:hover {{
    transform: scale(1.05);  /* 마우스 오버 시 버튼 크기 증가 */
}}
.glow-on-hover:active {{
    color: #000;  /* 버튼을 클릭할 때 글자 색상 변경 */
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

# 대표 이미지 생성 함수
def create_image_with_text(text):
    # 이미지 생성
    img = Image.new('RGB', (500, 300), color=(255, 255, 255))
    draw = ImageDraw.Draw(img)
    
    # 글자 그리기
    font = ImageFont.load_default()
    draw.text((10, 50), text, fill=(0, 0, 0), font=font)
    
    return img
# 메인 레이아웃 설정
st.title('블로그 작성 도우미')

# 키워드 입력
keyword = st.text_input("키워드를 입력하세요")
if st.button("키워드 분석"):
    if keyword:
        analysis_df = get_keyword_analysis(keyword)
        if not analysis_df.empty:
            st.dataframe(analysis_df)

# 키워드 통계 옵션
if st.button("키워드 통계 보기"):
    if not analysis_df.empty:
        total_searches = analysis_df['총검색수'].sum()
        average_mobile = analysis_df['월간검색수_모바일'].mean()
        average_pc = analysis_df['월간검색수_PC'].mean()
        
        st.write(f"총 검색 수: {total_searches}회")
        st.write(f"평균 모바일 검색 수: {average_mobile:.2f}회")
        st.write(f"평균 PC 검색 수: {average_pc:.2f}회")
    else:
        st.warning("먼저 키워드 분석을 수행하세요.")

# 애드센스 코드 및 버튼 생성
st.subheader("구글 애드센스 코드")
for name, code in adsense_codes.items():
    st.write(f"**{name}**")
    st.code(code)
    st.markdown(create_glowing_button("복사", "#"), unsafe_allow_html=True)

# 대표 이미지 생성 및 표시
if st.button("대표 이미지 생성"):
    img = create_image_with_text("대표 이미지")
    st.image(img, caption="생성된 대표 이미지", use_column_width=True)
