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
    @import url('https://fonts.googleapis.com/css2?family=Raleway:wght@400;700&display=swap');
    *{
        margin: 0;
        padding: 0;
        box-sizing: border-box;
    }
    body {
        display: flex;
        justify-content: center;
        align-items: center;
        height: 100vh;
        background: #050801;
        font-family: 'Raleway', sans-serif;
        font-weight: bold;
    }
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
    a {
        position: relative;
        display: inline-block;
        padding: 25px 30px;
        margin: 40px 0;
        color: #03e9f4;
        text-decoration: none;
        text-transform: uppercase;
        transition: 0.5s;
        letter-spacing: 4px;
        overflow: hidden;
        margin-right: 50px;
    }
    a:hover {
        background: #03e9f4;
        color: #050801;
        box-shadow: 0 0 5px #03e9f4,
                    0 0 25px #03e9f4,
                    0 0 50px #03e9f4,
                    0 0 200px #03e9f4;
        -webkit-box-reflect:below 1px linear-gradient(transparent, #0005);
    }
    a span {
        position: absolute;
        display: block;
    }
    a span:nth-child(1) {
        top: 0;
        left: 0;
        width: 100%;
        height: 2px;
        background: linear-gradient(90deg, transparent, #03e9f4);
        animation: animate1 1s linear infinite;
    }
    @keyframes animate1 {
        0% { left: -100%; }
        50%, 100% { left: 100%; }
    }
    a span:nth-child(2) {
        top: -100%;
        right: 0;
        width: 2px;
        height: 100%;
        background: linear-gradient(180deg, transparent, #03e9f4);
        animation: animate2 1s linear infinite;
        animation-delay: 0.25s;
    }
    @keyframes animate2 {
        0% { top: -100%; }
        50%, 100% { top: 100%; }
    }
    a span:nth-child(3) {
        bottom: 0;
        right: 0;
        width: 100%;
        height: 2px;
        background: linear-gradient(270deg, transparent, #03e9f4);
        animation: animate3 1s linear infinite;
        animation-delay: 0.50s;
    }
    @keyframes animate3 {
        0% { right: -100%; }
        50%, 100% { right: 100%; }
    }
    a span:nth-child(4) {
        bottom: -100%;
        left: 0;
        width: 2px;
        height: 100%;
        background: linear-gradient(360deg, transparent, #03e9f4);
        animation: animate4 1s linear infinite;
        animation-delay: 0.75s;
    }
    @keyframes animate4 {
        0% { bottom: -100%; }
        50%, 100% { bottom: 100%; }
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
        if st.button(f"{name} 광고 코드 복사", key=name):
            st.code(code, language='html')
            st.success(f"{name} 광고 코드가 표시되었습니다. 복사하여 사용하세요.")

# 반짝이는 버튼 생성 섹션
st.markdown('<div class="section-title">반짝이는 버튼 생성</div>', unsafe_allow_html=True)

button_text = st.text_input("버튼 텍스트 입력")
button_link = st.text_input("버튼 링크 입력")

if st.button("반짝이는 버튼 코드 생성"):
    button_code = f"""
    <a href="{button_link}" target="_blank">
        <span>{button_text}</span>
        <span></span>
        <span></span>
        <span></span>
    </a>
    """
    st.markdown(button_code, unsafe_allow_html=True)
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
    text_color1 = (244, 206, 20)  # 첫 번째 줄 흰색
    text_color2 = (245, 247, 248)  # 두 번째 줄 짙은 파란색
    text_color3 = (244, 206, 20)  # 세 번째 줄 흰색

    # 줄 간격 조정
    line_spacing = 120  # 간격 조정

    # 전체 텍스트를 아래로 내리기 위한 Y 좌표 조정
    base_y = height // 3  # Y 좌표를 높여서 아래로 내림

    # 첫 번째 줄
    text1_bbox = draw.textbbox((0, 0), text1, font=font)  # 텍스트 박스 크기
    draw.text(((width - (text1_bbox[2] - text1_bbox[0])) // 2, base_y - (text1_bbox[3] - text1_bbox[1]) // 2), text1, fill=text_color1, font=font)

    # 두 번째 줄
    text2_bbox = draw.textbbox((0, 0), text2, font=font)  # 텍스트 박스 크기
    draw.text(((width - (text2_bbox[2] - text2_bbox[0])) // 2, base_y + line_spacing - (text2_bbox[3] - text2_bbox[1]) // 2), text2, fill=text_color2, font=font)

    # 세 번째 줄
    text3_bbox = draw.textbbox((0, 0), text3, font=font)  # 텍스트 박스 크기
    draw.text(((width - (text3_bbox[2] - text3_bbox[0])) // 2, base_y + 2 * line_spacing - (text3_bbox[3] - text3_bbox[1]) // 2), text3, fill=text_color3, font=font)

    img.save(os.path.join(save_dir, "title_image.png"))
    return os.path.join(save_dir, "title_image.png")

# 이미지 다운로드 및 메타데이터 제거 실행 함수
def download_images_from_blog(blog_url):
    if blog_url:
        img_urls = get_image_urls_from_blog(blog_url)
        
        if img_urls:
            st.write(f"총 {len(img_urls)}개의 이미지를 찾았습니다.")
            image_paths = []
            
            for idx, img_url in enumerate(img_urls):
                save_path = remove_metadata_and_save_image(img_url, idx)

                # 이미지에 텍스트 추가
                if save_path:
                    # 이미지 열기
                    img = Image.open(save_path)
                    draw = ImageDraw.Draw(img)
                    
                    # 작은 폰트 설정 (왼쪽 하단 텍스트)
                    small_font_size = 30  # 작게 설정
                    small_font = ImageFont.truetype("NanumGothicCoding-Bold.ttf", small_font_size)
                    
                    # 텍스트 조합
                    small_text = f"{title_text1}, {title_text2}, {title_text3}"

                    # 테두리 효과를 주기 위한 텍스트를 두 번 그리기
                    # 먼저 검정색으로 테두리를 그림
                    outline_color = (0, 0, 0)  # 검정색
                    for x_offset in [-1, 0, 1]:  # x축으로 좌우 1px씩 이동
                        for y_offset in [-1, 0, 1]:  # y축으로 상하 1px씩 이동
                            draw.text((10 + x_offset, img.height - 50 + y_offset), small_text, fill=outline_color, font=small_font)

                    # 흰색으로 텍스트를 그림
                    draw.text((10, img.height - 50), small_text, fill=(255, 255, 255), font=small_font)  # 왼쪽 하단에 위치
                    
                    # 수정된 이미지 저장
                    img.save(save_path)
                    image_paths.append(save_path)
                    st.image(save_path, caption=f"Image {idx+1}", use_column_width=True)
            
            if image_paths:
                st.success(f"{len(image_paths)}개의 이미지가 성공적으로 다운로드되었습니다.")
                return image_paths
        else:
            st.write("이미지를 찾지 못했습니다.")
    else:
        st.write("블로그 URL을 입력해주세요.")
    return []

# 이미지 압축 파일 생성 함수
def create_zip_file(file_paths, zip_name="images.zip"):
    zip_path = os.path.join(save_dir, zip_name)
    with zipfile.ZipFile(zip_path, 'w') as zipf:
        for file in file_paths:
            zipf.write(file, os.path.basename(file))
    return zip_path

# 이미지 다운로드 및 처리 버튼
if st.button('이미지 다운로드 및 메타데이터 제거'):
    image_paths = download_images_from_blog(blog_url)
    
    if title_text1 and title_text2 and title_text3:
        title_image_path = create_title_image(title_text1, title_text2, title_text3)  # 대표 이미지 생성
        image_paths.append(title_image_path)  # 대표 이미지 경로 추가
        st.image(title_image_path, caption="대표 이미지", use_column_width=True)
    
    if image_paths:
        zip_file_path = create_zip_file(image_paths)
        with open(zip_file_path, "rb") as zip_file:
            st.download_button(
                label="이미지 압축 파일 다운로드",
                data=zip_file,
                file_name="images.zip",
                mime="application/zip"
            )

# 메인 실행 부분
if __name__ == "__main__":
    st.write("블로그 작성 도우미를 사용해 주셔서 감사합니다!")
