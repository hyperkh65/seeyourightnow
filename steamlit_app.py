import streamlit as st
import pandas as pd
import requests
import re
import time
import hmac
import hashlib
import base64
from PIL import Image, ImageDraw, ImageFont
from io import BytesIO

# 페이지 레이아웃을 넓게 설정
st.set_page_config(layout="wide", page_title="블로그 작성 도우미")

# CSS를 통해 전반적인 디자인 향상
st.markdown("""
    <style>
    .main-title {
        font-size: 3em;
        font-weight: bold;
        text-align: center;
        color: #4CAF50; /* 녹색 색상 */
        margin-bottom: 30px;
    }
    .section-title {
        font-size: 2em;
        margin-top: 30px;
        color: #FF5722; /* 주황색 */
    }
    .adsense-button {
        background-color: #4CAF50;
        color: white;
        font-size: 16px;
        padding: 10px;
        border-radius: 8px;
        margin-bottom: 10px;
        width: 100%;
        text-align: center;
    }
    .adsense-button:hover {
        background-color: #45a049;
        cursor: pointer;
    }
    .glow-on-hover {
        width: 220px;
        height: 50px;
        border: none;
        outline: none;
        color: #fff;
        background: red;
        cursor: pointer;
        position: relative;
        z-index: 0;
        border-radius: 10px;
        transition: transform 0.3s;
        margin: 0 auto;
        display: block;
    }
    .glow-on-hover:before {
        content: '';
        background: linear-gradient(45deg, red, orange, yellow, green, blue, indigo, violet);
        position: absolute;
        top: -2px;
        left: -2px;
        background-size: 400%;
        z-index: -1;
        filter: blur(5px);
        width: calc(100% + 4px);
        height: calc(100% + 4px);
        animation: glowing 20s linear infinite;
        opacity: 0.8;
        border-radius: 10px;
    }
    .glow-on-hover:hover {
        transform: scale(1.05);
    }
    @keyframes glowing {
        0% { background-position: 0 0; }
        50% { background-position: 400% 0; }
        100% { background-position: 0 0; }
    }
    </style>
    """, unsafe_allow_html=True)

# 페이지 제목
st.markdown('<div class="main-title">블로그 작성 도우미</div>', unsafe_allow_html=True)

# 구글 애드센스 코드 섹션
st.markdown('<div class="section-title">구글 애드센스 코드</div>', unsafe_allow_html=True)

adsense_codes = {
    "구라다": "<script async src='https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-8940400388075870' crossorigin='anonymous'></script>",
    "블로그스팟": "<script async src='https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-8940400388075870' crossorigin='anonymous'></script>",
    "미라클E": "<script async src='https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-8940400388075870' crossorigin='anonymous'></script>"
}

# 버튼을 컬럼으로 나누어서 더 보기 좋게
cols = st.columns(3)
for i, (name, code) in enumerate(adsense_codes.items()):
    with cols[i]:
        if st.button(f"{name} 광고 코드 복사"):
            st.code(code, language='html')
            st.success(f"{name} 광고 코드가 표시되었습니다. 복사하여 사용하세요.")

# 반짝이는 버튼 생성 섹션
st.markdown('<div class="section-title">반짝이는 버튼 생성</div>', unsafe_allow_html=True)

link_input = st.text_input("링크를 입력하세요:")
button_text = st.text_input("버튼 텍스트를 입력하세요:")
if st.button("버튼 생성"):
    st.markdown(f'<a href="{link_input}" class="glow-on-hover">{button_text}</a>', unsafe_allow_html=True)

# 이미지 다운로드 기능 섹션
st.markdown('<div class="section-title">블로그 이미지 다운로드</div>', unsafe_allow_html=True)

title_text = st.text_input("이미지에 넣을 제목을 입력하세요:")
if st.button("이미지 생성 및 다운로드"):
    img_buffer = create_title_image(title_text)
    st.download_button("이미지 다운로드", img_buffer, "title_image.png")

# 블로그 글 작성 도구 섹션
st.markdown('<div class="section-title">블로그 글 작성 도구</div>', unsafe_allow_html=True)

text_option = st.selectbox("글 작성 형식 선택", ("HTML", "Markdown", "Plain Text"))
blog_content = st.text_area("블로그 내용을 작성하세요:")
if st.button("결과 보기"):
    if text_option == "HTML":
        st.markdown(blog_content, unsafe_allow_html=True)
    elif text_option == "Markdown":
        st.markdown(blog_content)
    else:
        st.write(blog_content)

# 연관 검색어 통계 섹션
st.markdown('<div class="section-title">연관 검색어 통계</div>', unsafe_allow_html=True)

keyword_input = st.text_input("검색어를 입력하세요:")
if st.button("통계 보기"):
    related_keywords = get_related_keywords(keyword_input)
    if related_keywords:
        st.write("연관 검색어 통계:")
        for keyword in related_keywords:
            st.write(f"- {keyword}")
    else:
        st.write("연관 검색어를 찾을 수 없습니다.")

# 필요 함수 정의
def create_title_image(text):
    # 제목이 들어간 이미지 생성
    img = Image.new('RGB', (800, 400), color='white')
    draw = ImageDraw.Draw(img)
    
    # 사용할 폰트 설정 (폰트 파일이 필요합니다)
    try:
        font = ImageFont.truetype("arial.ttf", 50)  # 사용할 폰트 파일
    except IOError:
        font = ImageFont.load_default()  # 기본 폰트 사용

    # 텍스트의 크기 계산
    text_size = draw.textsize(text, font=font)
    text_x = (img.width - text_size[0]) / 2
    text_y = (img.height - text_size[1]) / 2

    # 이미지에 텍스트 추가
    draw.text((text_x, text_y), text, fill='black', font=font)
    
    # 이미지 버퍼에 저장
    img_buffer = BytesIO()
    img.save(img_buffer, format="PNG")
    img_buffer.seek(0)  # 버퍼 위치를 처음으로 되돌림

    return img_buffer

def get_related_keywords(keyword):
    # 여기에 API 호출 또는 웹 스크래핑을 통해 연관 검색어 통계 가져오기
    # 예시로 간단한 리스트 반환
    return [f"{keyword}의 연관 검색어 1", f"{keyword}의 연관 검색어 2", f"{keyword}의 연관 검색어 3"]
