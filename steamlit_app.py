import streamlit as st
import pandas as pd
import requests
import re
import time
import hmac
import hashlib
import base64
from bs4 import BeautifulSoup
from PIL import Image, ImageDraw, ImageFont
from io import BytesIO
import os
import zipfile

# 페이지 레이아웃을 넓게 설정
st.set_page_config(layout="wide", page_title="블로그 작성 도우미")

# CSS를 통해 전반적인 디자인 향상
st.markdown("""
    <style>
    .main-title {
        font-size: 3em;
        font-weight: bold;
        text-align: center;
        color: #4CAF50;
        margin-bottom: 30px;
    }
    .section-title {
        font-size: 2em;
        margin-top: 30px;
        color: #FF5722;
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

button_text = st.text_input("버튼 텍스트 입력")
button_link = st.text_input("버튼 링크 입력")

if st.button("반짝이는 버튼 코드 생성"):
    button_code = f"""
    <a href="{button_link}" target="_blank">
        <button class="glow-on-hover" type="button">{button_text}</button>
    </a>
    """
    st.code(button_code, language='html')
    st.success("반짝이는 버튼 코드가 생성되었습니다. 위의 코드를 복사하여 사용하세요.")
    st.markdown(button_code, unsafe_allow_html=True)

# 블로그 작성 섹션
st.markdown('<div class="section-title">블로그 글 작성</div>', unsafe_allow_html=True)

text_format = st.radio("텍스트 형식 선택", ("HTML", "Markdown", "일반 텍스트"))
input_text = st.text_area("블로그 글을 작성하세요", height=300)

# 작성된 글 미리보기 섹션
st.markdown('<div class="section-title">작성된 블로그 글 미리 보기</div>', unsafe_allow_html=True)
if text_format == "HTML":
    st.markdown(input_text, unsafe_allow_html=True)
elif text_format == "Markdown":
    st.markdown(input_text)
else:
    st.text(input_text)

# 키워드 분석 섹션
st.markdown('<div class="section-title">키워드 분석</div>', unsafe_allow_html=True)
keywords = st.text_area('분석할 키워드를 입력하세요 (쉼표로 구분)', 'chatgpt, 인공지능').split(',')
keywords_to_bold = st.text_input("굵게 표시할 키워드를 입력하세요 (쉼표로 구분)").split(',')

# 키워드 분석 버튼
if st.button('키워드 분석 실행'):
    st.info("분석 결과가 표시될 예정입니다.")

# 이미지 다운로드 및 처리 섹션
st.markdown('<div class="section-title">이미지 다운로드 및 처리</div>', unsafe_allow_html=True)

# 이미지 저장 경로
save_dir = "downloaded_images"
os.makedirs(save_dir, exist_ok=True)

# 티스토리 블로그 주소 입력
blog_url = st.text_input('티스토리 블로그 주소를 입력하세요', '')

# 대표 이미지 텍스트 입력
title_text1 = st.text_input('대표 이미지 첫 번째 줄에 사용할 텍스트를 입력하세요', '')
title_text2 = st.text_input('대표 이미지 두 번째 줄에 사용할 텍스트를 입력하세요', '')
title_text3 = st.text_input('대표 이미지 세 번째 줄에 사용할 텍스트를 입력하세요', '')

# 티스토리 블로그의 본문에서 이미지를 추출하는 함수
def get_image_urls_from_blog(url):
    try:
        response = requests.get(url)
        soup = BeautifulSoup(response.text, 'html.parser')
        img_tags = soup.find_all('img')
        img_urls = []
        for img in img_tags:
            img_url = img.get('src')
            if img_url:
                if not img_url.startswith('http'):
                    img_url = 'http:' + img_url
                img_urls.append(img_url)
        return img_urls
    except Exception as e:
        st.error(f"페이지를 불러오는 중 오류가 발생했습니다: {e}")
        return []

# 블로그 본문에서 링크를 추출하는 함수
def get_links_from_blog(url):
    try:
        response = requests.get(url)
        soup = BeautifulSoup(response.text, 'html.parser')
        links = []
        for anchor in soup.find_all('a', href=True):
            link_name = anchor.get_text(strip=True)
            link_url = anchor['href']
            links.append((link_name, link_url))
        return links
    except Exception as e:
        st.error(f"링크를 불러오는 중 오류가 발생했습니다: {e}")
        return []

# 이미지 메타 데이터를 제거하는 함수
def remove_metadata_and_save_image(image_url, idx):
    try:
        response = requests.get(image_url)
        img = Image.open(BytesIO(response.content))
        
        # 이미지 모드에 따라 저장 형식을 결정
        if img.mode in ["RGBA", "P"]:
            img = img.convert("RGB")  # JPEG로 저장하기 위해 RGB로 변환
            
        img_without_metadata = Image.new(img.mode, img.size)
        img_without_metadata.putdata(list(img.getdata()))
        
        file_extension = image_url.split('.')[-1].split('?')[0]
        safe_filename = re.sub(r'[^a-zA-Z0-9]', '_', image_url.split('/')[-1])
        image_filename = f"image_{idx+1}_{safe_filename[:10]}.{file_extension}"
        save_path = os.path.join(save_dir, image_filename)
        
        img_without_metadata.save(save_path, format=img.format)
        return save_path
    except Exception as e:
        st.error(f"이미지를 처리하는 중 오류 발생: {e}")
        return None

# 대표 이미지 생성 함수
def create_title_image(text1, text2, text3):
    width = 800
    height = 400
    image = Image.new("RGB", (width, height), (255, 255, 255))
    draw = ImageDraw.Draw(image)

    # 폰트 설정
    try:
        font = ImageFont.truetype("NanumGothicCoding-Bold.ttf", 40)
    except IOError:
        font = ImageFont.load_default()

    # 텍스트 위치 설정
    draw.text((50, 50), text1, fill="black", font=font)
    draw.text((50, 150), text2, fill="black", font=font)
    draw.text((50, 250), text3, fill="black", font=font)

    title_image_path = os.path.join(save_dir, "title_image.jpg")
    image.save(title_image_path)
    return title_image_path

# 이미지와 링크 처리 및 다운로드 섹션
if st.button("이미지 다운로드 및 링크 추출"):
    img_urls = get_image_urls_from_blog(blog_url)
    links = get_links_from_blog(blog_url)

    # 대표 이미지 생성
    title_image_path = create_title_image(title_text1, title_text2, title_text3)

    # ZIP 파일 생성
    zip_filename = "downloaded_images.zip"
    zip_path = os.path.join(save_dir, zip_filename)

    with zipfile.ZipFile(zip_path, 'w') as zip_file:
        # 대표 이미지 추가
        zip_file.write(title_image_path, os.path.basename(title_image_path))

        # 블로그 이미지 추가
        for idx, img_url in enumerate(img_urls):
            img_path = remove_metadata_and_save_image(img_url, idx)
            if img_path:
                zip_file.write(img_path, os.path.basename(img_path))

    # 링크 출력
    st.markdown('<div class="section-title">추출된 링크 목록</div>', unsafe_allow_html=True)
    for link_name, link_url in links:
        col1, col2, col3 = st.columns([3, 6, 2])
        with col1:
            st.write(link_name)
        with col2:
            st.write(link_url)
        with col3:
            # 링크 복사 버튼
            if st.button("복사", key=link_url):  # 각 링크에 대해 고유한 키를 사용하여 버튼 생성
                st.success("링크가 복사되었습니다.")
                # 클립보드에 복사하는 JavaScript 코드
                js_code = f"""
                    <script>
                    navigator.clipboard.writeText('{link_url}');
                    </script>
                """
                st.markdown(js_code, unsafe_allow_html=True)

    # ZIP 파일 다운로드 링크 제공
    with open(zip_path, 'rb') as f:
        st.download_button('다운로드 ZIP 파일', f, file_name=zip_filename)

    st.success("이미지를 다운로드하고 링크를 추출했습니다.")

