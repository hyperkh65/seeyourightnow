import streamlit as st
import urllib.request
import json
import pandas as pd
import requests
import time
import hashlib
import hmac
import base64
import concurrent.futures
import re

# 사용자 입력 부분을 Streamlit으로 변경
st.title('블로그 작성 도우미')

# st.secrets에서 API 키를 불러옴
CUSTOMER_ID = st.secrets["general"]["CUSTOMER_ID"]
API_KEY = st.secrets["general"]["API_KEY"]
SECRET_KEY = st.secrets["general"]["SECRET_KEY"]
client_id = st.secrets["general"]["client_id"]
client_secret = st.secrets["general"]["client_secret"]

# 키워드 입력 및 결과를 표시할 열 생성
col1, col2 = st.columns(2)

# 첫 번째 열 (왼쪽) - 키워드 분석 및 기타 기능
with col1:
    st.header("키워드 분석 및 기타 기능")
    
    # 키워드 입력
    keywords = st.text_area('분석할 키워드를 입력하세요 (쉼표로 구분)', 'chatgpt').split(',')

    # 블로그 글 작성
    input_text = st.text_area("블로그 글을 작성하세요", height=300)

    # 굵게 표시할 키워드 입력
    keywords_to_bold = st.text_input("굵게 표시할 키워드를 입력하세요 (쉼표로 구분)").split(',')

    # 이모티콘 버튼
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

    # 결과 미리 보기
    st.subheader("작성된 블로그 글 미리 보기:")
    st.markdown(input_text, unsafe_allow_html=True)

# 두 번째 열 (오른쪽) - 키워드 분석 결과
with col2:
    st.header("키워드 분석 결과")

    # Streamlit 버튼으로 키워드 분석 실행
    if st.button('분석 실행'):
        tmp_df = pd.DataFrame()

        with st.spinner('키워드 분석 중...'):
            for keyword in keywords:
                keyword = keyword.strip()  # 공백 제거
                if keyword:  # 키워드가 비어있지 않은 경우에만 분석
                    df = get_keyword_analysis(keyword)  # 이전에 구현된 키워드 분석 함수
                    tmp_df = pd.concat([tmp_df, df], axis=0)

        if not tmp_df.empty:
            st.write(tmp_df)

# 키워드 분석 관련 함수 구현 (이전 코드와 유사)
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

# 추가적으로 필요한 함수들도 여기에 구현해야 합니다.
