import streamlit as st
import requests
import re
import os
from bs4 import BeautifulSoup
from PIL import Image, ImageDraw, ImageFont
from io import BytesIO
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

# 이미지 메타 데이터를 제거하고 저장하는 함수
def remove_metadata_and_save_image(image_url, idx):
    try:
        response = requests.get(image_url)
        img = Image.open(BytesIO(response.content)).convert("RGB")  # RGB로 변환하여 메타데이터 제거
        img_without_metadata = Image.new("RGB", img.size)
        img_without_metadata.paste(img)

        file_extension = image_url.split('.')[-1].split('?')[0]
        safe_filename = re.sub(r'[^a-zA-Z0-9]', '_', image_url.split('/')[-1])
        image_filename = f"image_{idx+1}_{safe_filename[:10]}.{file_extension}"
        save_path = os.path.join(save_dir, image_filename)

        img_without_metadata.save(save_path, format='PNG')  # PNG 형식으로 저장
        return save_path
    except Exception as e:
        st.error(f"이미지를 처리하는 중 오류 발생: {e}")
        return None

# 대표 이미지 생성 함수
def create_title_image(text1, text2, text3):
    width, height = 800, 800
    background_color = (73, 94, 87)  # 배경색
    img = Image.new('RGB', (width, height), background_color)
    draw = ImageDraw.Draw(img)

    # 폰트 설정
    font_path = "NanumGothicCoding-Bold.ttf"  # 로컬에서 사용하는 폰트
    font_size = 100
    font = ImageFont.truetype(font_path, font_size)

    # 텍스트 색상 설정
    text_color1 = (244, 206, 20)  # 첫 번째 줄 색상
    text_color2 = (244, 206, 20)  # 두 번째 줄 색상
    text_color3 = (244, 206, 20)  # 세 번째 줄 색상

    # 텍스트 위치 계산
    text1_width, text1_height = draw.textsize(text1, font=font)
    text2_width, text2_height = draw.textsize(text2, font=font)
    text3_width, text3_height = draw.textsize(text3, font=font)

    # 텍스트 그리기
    draw.text(((width - text1_width) / 2, (height - text1_height) / 4), text1, font=font, fill=text_color1)
    draw.text(((width - text2_width) / 2, (height - text2_height) / 2), text2, font=font, fill=text_color2)
    draw.text(((width - text3_width) / 2, (height - text3_height) * 3 / 4), text3, font=font, fill=text_color3)

    return img

# 이미지 다운로드 버튼
if st.button("블로그 이미지 다운로드"):
    image_urls = get_image_urls_from_blog(blog_url)

    if not image_urls:
        st.warning("이미지가 없습니다.")
    else:
        zip_filename = "downloaded_images.zip"
        with zipfile.ZipFile(zip_filename, 'w') as zip_file:
            # 대표 이미지 생성 및 저장
            title_image = create_title_image(title_text1, title_text2, title_text3)
            title_image_path = "title_image.png"
            title_image.save(title_image_path)

            # 대표 이미지를 ZIP 파일에 추가
            zip_file.write(title_image_path)

            # 블로그 이미지 다운로드 및 ZIP 파일에 추가
            for idx, image_url in enumerate(image_urls):
                image_path = remove_metadata_and_save_image(image_url, idx)
                if image_path:
                    # 블로그 이미지 하단에 대표 이미지 텍스트 추가
                    img = Image.open(image_path)
                    draw = ImageDraw.Draw(img)
                    font = ImageFont.truetype("NanumGothicCoding-Bold.ttf", 30)
                    text = f"{title_text1}, {title_text2}, {title_text3}"
                    draw.text((10, img.height - 40), text, fill=(255, 255, 255), font=font)
                    img.save(image_path)
                    
                    zip_file.write(image_path)

        # ZIP 파일 다운로드
        with open(zip_filename, 'rb') as f:
            st.download_button('다운로드 ZIP 파일', f, file_name=zip_filename)

# 블로그 링크 복사 기능
if blog_url:
    st.markdown(f"[블로그 링크]({blog_url})")
    if st.button("링크 복사"):
        st.session_state['link_to_copy'] = blog_url
        st.success("링크가 클립보드에 복사되었습니다.")
