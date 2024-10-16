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

# 왼쪽 옵션 창에 버튼 만들기 및 대표 이미지 생성 섹션 추가
st.sidebar.markdown('<div class="section-title">반짝이는 버튼 생성</div>', unsafe_allow_html=True)

button_text = st.sidebar.text_input("버튼 텍스트 입력")
button_link = st.sidebar.text_input("버튼 링크 입력")

if st.sidebar.button("반짝이는 버튼 코드 생성"):
    button_code = f"""
    <a href="{button_link}" target="_blank">
        <button class="glow-on-hover" type="button">{button_text}</button>
    </a>
    """
    st.sidebar.code(button_code, language='html')
    st.sidebar.success("반짝이는 버튼 코드가 생성되었습니다. 위의 코드를 복사하여 사용하세요.")
    st.sidebar.markdown(button_code, unsafe_allow_html=True)

# 블로그 주소 입력 및 대표 이미지 텍스트 입력 섹션
st.sidebar.markdown('<div class="section-title">이미지 다운로드 및 처리</div>', unsafe_allow_html=True)
blog_url = st.sidebar.text_input('티스토리 블로그 주소를 입력하세요', '')

# 대표 이미지 텍스트 입력
title_text1 = st.sidebar.text_input('대표 이미지 첫 번째 줄에 사용할 텍스트를 입력하세요', '')
title_text2 = st.sidebar.text_input('대표 이미지 두 번째 줄에 사용할 텍스트를 입력하세요', '')
title_text3 = st.sidebar.text_input('대표 이미지 세 번째 줄에 사용할 텍스트를 입력하세요', '')

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

# 이미지 저장 경로
save_dir = "downloaded_images"
os.makedirs(save_dir, exist_ok=True)

# 티스토리 블로그의 본문에서 이미지를 추출하는 함수
def get_image_urls_from_blog(url):
    try:
        response = requests.get(url)
        if response.status_code != 200:
            st.error(f"Failed to fetch the URL: {url} with status code: {response.status_code}")
            return []
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
        st.error(f"Error while fetching images: {e}")
        return []

# 이미지 메타 데이터를 제거하는 함수
def remove_metadata_and_save_image(image_url, idx):
    try:
        response = requests.get(image_url)
        img = Image.open(BytesIO(response.content))
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
    width, height = 800, 800
    background_color = (73, 94, 87)  # 짙은 하늘색 배경
    img = Image.new('RGB', (width, height), background_color)
    draw = ImageDraw.Draw(img)

    # 폰트 설정
    font_path = "NanumGothicCoding-Bold.ttf"  # 로컬에서 사용하는 폰트
    font_size = 100
    font = ImageFont.truetype(font_path, font_size)

    # 텍스트 색상 설정
    text_color1 = (244, 206, 0)  # 노란색
    text_color2 = (255, 255, 255)  # 흰색
    text_color3 = (255, 0, 0)      # 빨간색

    # 텍스트 그리기
    draw.text((50, 100), text1, fill=text_color1, font=font)
    draw.text((50, 300), text2, fill=text_color2, font=font)
    draw.text((50, 500), text3, fill=text_color3, font=font)

    img.save(os.path.join(save_dir, "title_image.png"))

# 블로그 주소에서 이미지 가져오기 버튼
if st.sidebar.button("블로그 이미지 가져오기"):
    if blog_url:
        image_urls = get_image_urls_from_blog(blog_url)
        image_paths = []
        for idx, image_url in enumerate(image_urls):
            image_path = remove_metadata_and_save_image(image_url, idx)
            if image_path:
                image_paths.append(image_path)

        if image_paths:
            st.success(f"{len(image_paths)}개의 이미지를 다운로드했습니다.")
            for image_path in image_paths:
                st.image(image_path, caption=image_path.split('/')[-1], use_column_width=True)
        else:
            st.error("다운로드한 이미지가 없습니다.")

# 대표 이미지 생성 버튼
if st.sidebar.button("대표 이미지 생성"):
    if title_text1 or title_text2 or title_text3:
        create_title_image(title_text1, title_text2, title_text3)
        st.success("대표 이미지가 생성되었습니다!")
        st.image(os.path.join(save_dir, "title_image.png"), caption="대표 이미지", use_column_width=True)

# 링크 목록 생성 및 유지
link_list = []
if st.button("링크 추가"):
    link_name = st.text_input("링크 이름")
    link_url = st.text_input("링크 주소")
    if link_name and link_url:
        link_list.append((link_name, link_url))
        st.success("링크가 추가되었습니다.")

# 링크 목록 출력
st.markdown('<div class="section-title">링크 목록</div>', unsafe_allow_html=True)
for link_name, link_url in link_list:
    st.write(f"{link_name} ({link_url})")
    if st.button(f"링크 복사: {link_name}", key=link_name):
        st.markdown(f'<script>navigator.clipboard.writeText("{link_url}");</script>', unsafe_allow_html=True)
        st.success(f"{link_name} 링크가 클립보드에 복사되었습니다.")

# 압축 파일 다운로드 버튼
if st.button("이미지 압축 다운로드"):
    zip_filename = "downloaded_images.zip"
    with zipfile.ZipFile(zip_filename, 'w') as zip_file:
        for root, _, files in os.walk(save_dir):
            for file in files:
                zip_file.write(os.path.join(root, file), file)
    st.success("이미지를 압축하여 다운로드할 수 있습니다.")
    with open(zip_filename, 'rb') as f:
        st.download_button('압축 파일 다운로드', f, file_name=zip_filename)

