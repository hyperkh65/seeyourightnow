import streamlit as st
import pandas as pd
import requests
import re
import time

# 페이지 레이아웃을 넓게 설정
st.set_page_config(layout="wide", page_title="블로그 작성 도우미")

# st.secrets에서 API 키 불러오기
CUSTOMER_ID = st.secrets["general"]["CUSTOMER_ID"]
API_KEY = st.secrets["general"]["API_KEY"]
SECRET_KEY = st.secrets["general"]["SECRET_KEY"]
client_id = st.secrets["general"]["client_id"]
client_secret = st.secrets["general"]["client_secret"]

# 키워드 분석 관련 함수
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
    r = requests.get(
        BASE_URL + uri,
        params={'hintKeywords': keyword, 'showDetail': 1},
        headers=get_request_header(method, uri)
    )
    df = pd.DataFrame(r.json()['keywordList'])
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
    return df

# 메인 레이아웃 설정 (좌측, 우측 화면 반반)
st.title('블로그 작성 도우미')

col1, col2 = st.columns([2, 1])  # 첫 번째 열을 더 넓게 설정 (2:1 비율)

# 첫 번째 열 - 키워드 분석 및 블로그 작성 기능
with col1:
    st.header("키워드 분석 및 블로그 작성")
    
    # 키워드 입력
    keywords = st.text_area('분석할 키워드를 입력하세요 (쉼표로 구분)', 'chatgpt, 인공지능').split(',')

    # 블로그 글 작성
    input_text = st.text_area("블로그 글을 작성하세요", height=300)

    # 굵게 표시할 키워드 입력
    keywords_to_bold = st.text_input("굵게 표시할 키워드를 입력하세요 (쉼표로 구분)").split(',')

    # 이모티콘 추가 버튼
    emoji_list = [("😀", "😀"), ("😂", "😂"), ("😍", "😍"), ("👍", "👍"), ("🎉", "🎉")]
    for emoji, emoji_symbol in emoji_list:
        if st.button(emoji):
            input_text += emoji_symbol  # 이모티콘 추가

    # 키워드 강조 기능
    for keyword in keywords_to_bold:
        keyword = keyword.strip()
        if keyword:
            # HTML로 키워드를 굵게 표시
            input_text = re.sub(r'({})'.format(re.escape(keyword)), r'<strong>\1</strong>', input_text)

    # 작성된 글 미리보기
    st.subheader("작성된 블로그 글 미리 보기:")
    st.markdown(input_text, unsafe_allow_html=True)

# 두 번째 열 - 키워드 분석 결과
with col2:
    st.header("키워드 분석 결과")

    # 키워드 분석 실행 버튼
    if st.button('분석 실행'):
        tmp_df = pd.DataFrame()

        with st.spinner('키워드 분석 중...'):
            for keyword in keywords:
                keyword = keyword.strip()  # 공백 제거
                if keyword:  # 키워드가 비어있지 않으면 분석 실행
                    df = get_keyword_analysis(keyword)
                    tmp_df = pd.concat([tmp_df, df], axis=0)

        if not tmp_df.empty:
            st.write(tmp_df)

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

# 추가적으로 필요한 함수들도 여기에 구현할 수 있습니다.
