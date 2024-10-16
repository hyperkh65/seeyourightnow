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

# 이미지 메타 데이터를 제거하는 함수
def remove_metadata_and_save_image(image_url, idx):
    try:
        response = requests.get(image_url)
        img = Image.open(BytesIO(response.content))
        img_without_metadata = Image.new(img.mode, img.size)
        img_without_metadata.putdata(list(img.getdata()))
        
        # JPEG로 저장하기 위한 포맷 처리
        if img.mode in ["RGBA", "P"]:  # RGBA 및 P 모드 처리
            img = img.convert("RGB")

        file_extension = 'png'  # PNG 포맷으로 저장
        safe_filename = re.sub(r'[^a-zA-Z0-9]', '_', image_url.split('/')[-1])
        image_filename = f"image_{idx+1}_{safe_filename[:10]}.{file_extension}"
        save_path = os.path.join(save_dir, image_filename)
        
        img_without_metadata.save(save_path, format='PNG')
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
    text_color2 = (245, 255, 250)  # 두 번째 줄 흰색
    text_color3 = (245, 255, 250)  # 세 번째 줄 흰색

    # 텍스트를 이미지 중앙에 배치
    draw.text((width // 2, height // 4), text1, fill=text_color1, font=font, anchor="mm")
    draw.text((width // 2, height // 2), text2, fill=text_color2, font=font, anchor="mm")
    draw.text((width // 2, 3 * height // 4), text3, fill=text_color3, font=font, anchor="mm")

    title_image_path = os.path.join(save_dir, "title_image.png")
    img.save(title_image_path)
    
    return title_image_path

# 블로그 링크 분석 및 이미지 다운로드 섹션
if st.button("이미지 다운로드"):
    if blog_url:
        image_urls = get_image_urls_from_blog(blog_url)
        if image_urls:
            title_image_path = create_title_image(title_text1, title_text2, title_text3)

            # 이미지 다운로드 및 저장
            saved_image_paths = []
            for idx, image_url in enumerate(image_urls):
                saved_image_path = remove_metadata_and_save_image(image_url, idx)
                if saved_image_path:
                    saved_image_paths.append(saved_image_path)

            # ZIP 파일 생성
            zip_filename = "downloaded_images.zip"
            with zipfile.ZipFile(zip_filename, 'w') as zip_file:
                # 제목 이미지 추가
                zip_file.write(title_image_path, arcname=os.path.basename(title_image_path))
                # 다운로드한 이미지 추가
                for saved_image_path in saved_image_paths:
                    zip_file.write(saved_image_path, arcname=os.path.basename(saved_image_path))

            with open(zip_filename, 'rb') as f:
                st.download_button(
                    label="다운로드 ZIP 파일",
                    data=f,
                    file_name=zip_filename,
                    mime="application/zip"
                )
            st.success(f"{len(saved_image_paths)}개의 이미지를 다운로드했습니다.")
        else:
            st.warning("이미지를 찾을 수 없습니다.")
    else:
        st.warning("블로그 URL을 입력해 주세요.")

# 블로그 링크 섹션
if blog_url:
    st.markdown('<div class="section-title">블로그 링크</div>', unsafe_allow_html=True)
    
    # 블로그 제목
    st.write(f"블로그 제목: [{blog_url}]({blog_url})")
    
    # 링크 복사 버튼
    if st.button("링크 복사"):
        st.markdown(f"[블로그 링크 복사]({blog_url})", unsafe_allow_html=True)
        st.success("블로그 링크가 클립보드에 복사되었습니다.")

    # 링크 이름 및 링크 리스트 생성
    link_names = st.text_area("링크 이름 및 주소를 입력하세요 (형식: 이름, 주소)", height=100)
    if st.button("링크 추가"):
        if link_names:
            links = link_names.split('\n')
            for link in links:
                if ',' in link:
                    name, url = map(str.strip, link.split(',', 1))
                    st.markdown(f"[{name}]({url})")
                    if st.button(f"{name} 링크 복사"):
                        st.markdown(f"[링크 복사]({url})", unsafe_allow_html=True)
                        st.success(f"{name} 링크가 클립보드에 복사되었습니다.")

# 필요 시 이미지 저장 폴더 삭제
if st.button("이미지 저장 폴더 삭제"):
    for filename in os.listdir(save_dir):
        file_path = os.path.join(save_dir, filename)
        try:
            if os.path.isfile(file_path):
                os.unlink(file_path)
        except Exception as e:
            st.error(f"파일 삭제 중 오류 발생: {e}")
    st.success("저장된 이미지 파일을 삭제했습니다.")

