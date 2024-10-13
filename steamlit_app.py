import streamlit as st
import pandas as pd
import requests
import re
import time
import hmac
import hashlib
import base64

# Page configuration
st.set_page_config(layout="wide", page_title="Blog Writing Assistant")

# Load API keys from st.secrets
CUSTOMER_ID = st.secrets["general"]["CUSTOMER_ID"]
API_KEY = st.secrets["general"]["API_KEY"]
SECRET_KEY = st.secrets["general"]["SECRET_KEY"]
client_id = st.secrets["general"]["client_id"]
client_secret = st.secrets["general"]["client_secret"]

# Constants
BASE_URL = "https://api.naver.com"  # Add the base URL for the API

# Keyword analysis related functions
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

# Main layout
st.title('Blog Writing Assistant')
col1, col2 = st.columns([2, 1])

# First column - Keyword analysis and blog writing
with col1:
    st.header("Keyword Analysis and Blog Writing")
    
    keywords = st.text_area('Enter keywords to analyze (comma-separated)', 'chatgpt, artificial intelligence').split(',')
    input_text = st.text_area("Write your blog post", height=300)
    keywords_to_bold = st.text_input("Enter keywords to bold (comma-separated)").split(',')

    # Emoji buttons
    emoji_list = [("😀", "😀"), ("😂", "😂"), ("😍", "😍"), ("👍", "👍"), ("🎉", "🎉")]
    cols = st.columns(len(emoji_list))
    for idx, (emoji, emoji_symbol) in enumerate(emoji_list):
        with cols[idx]:
            if st.button(emoji):
                input_text += emoji_symbol
                st.experimental_rerun()

    # Keyword emphasis
    for keyword in keywords_to_bold:
        keyword = keyword.strip()
        if keyword:
            input_text = re.sub(r'({})'.format(re.escape(keyword)), r'<strong>\1</strong>', input_text)

    # Blog post preview
    st.subheader("Blog Post Preview:")
    st.markdown(input_text, unsafe_allow_html=True)

# Second column - Keyword analysis results
with col2:
    st.header("Keyword Analysis Results")
    if st.button('Run Analysis'):
        tmp_df = pd.DataFrame()
        with st.spinner('Analyzing keywords...'):
            for keyword in keywords:
                keyword = keyword.strip()
                if keyword:
                    df = get_keyword_analysis(keyword)
                    tmp_df = pd.concat([tmp_df, df], axis=0)
        if not tmp_df.empty:
            st.dataframe(tmp_df)
        else:
            st.warning("No results found. Please check your keywords and try again.")
