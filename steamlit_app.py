import streamlit as st
import pandas as pd
import requests
import re
import zipfile
from PIL import Image, ImageDraw, ImageFont
from io import BytesIO
import os
from bs4 import BeautifulSoup

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

button_text = st.text_input("버튼 텍스트를 입력하세요:", "복사하기")
if st.button("반짝이는 버튼 생성"):
    st.markdown(f'<button class="glow-on-hover">{button_text}</button>', unsafe_allow_html=True)

# 이미지 다운로드 및 메타데이터 제거 기능
st.markdown('<div class="section-title">이미지 다운로드 및 메타데이터 제거</div>', unsafe_allow_html=True)

# 유저가 입력할 티스토리 블로그 주소
blog_url = st.text_input('티스토리 블로그 주소를 입력하세요', '')
# 대표 이미지에 사용할 텍스트
title_text1 = st.text_input('대표 이미지 첫 번째 줄에 사용할 텍스트를 입력하세요', '')
title_text2 = st.text_input('대표 이미지 두 번째 줄에 사용할 텍스트를 입력하세요', '')
title_text3 = st.text_input('대표 이미지 세 번째 줄에 사용할 텍스트를 입력하세요', '')

# 이미지 저장 경로
save_dir = "downloaded_images"
os.makedirs(save_dir, exist_ok=True)

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
    text_color1 = (244, 206, 20)  # 첫 번째 줄 색상
    text_color2 = (245, 247, 248)  # 두 번째 줄 색상
    text_color3 = (244, 206, 20)  # 세 번째 줄 색상

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
    draw.text(((width - (text3_bbox[2] - text3_bbox[0])) // 2, base_y + line_spacing * 2 - (text3_bbox[3] - text3_bbox[1]) // 2), text3, fill=text_color3, font=font)

    return img

# 다운로드 및 압축 기능
if st.button('이미지 다운로드 및 압축'):
    if blog_url:
        image_urls = get_image_urls_from_blog(blog_url)
        if image_urls:
            saved_images = []
            for idx, image_url in enumerate(image_urls):
                saved_image_path = remove_metadata_and_save_image(image_url, idx)
                if saved_image_path:
                    saved_images.append(saved_image_path)

            if title_text1 or title_text2 or title_text3:
                title_image = create_title_image(title_text1, title_text2, title_text3)
                title_image_path = os.path.join(save_dir, "title_image.png")
                title_image.save(title_image_path)

                saved_images.append(title_image_path)

            # 압축 파일 생성
            zip_filename = "images.zip"
            zip_filepath = os.path.join(save_dir, zip_filename)

            with zipfile.ZipFile(zip_filepath, 'w') as zip_file:
                for image_path in saved_images:
                    zip_file.write(image_path, os.path.basename(image_path))

            # 압축 파일 다운로드
            with open(zip_filepath, 'rb') as f:
                st.download_button(
                    label='압축 파일 다운로드',
                    data=f,
                    file_name=zip_filename,
                    mime='application/zip'
                )
        else:
            st.error("블로그에서 이미지를 찾을 수 없습니다.")
    else:
        st.error("블로그 URL을 입력하세요.")

# 글 작성 도구
st.markdown('<div class="section-title">글 작성 도구</div>', unsafe_allow_html=True)

blog_content = st.text_area("블로그 내용을 입력하세요", height=300)
keyword_input = st.text_input("키워드를 입력하세요 (쉼표로 구분)", "")

if st.button("키워드 통계"):
    if blog_content and keyword_input:
        keywords = [kw.strip() for kw in keyword_input.split(",")]
        keyword_counts = {kw: blog_content.count(kw) for kw in keywords}
        st.write("키워드 통계:")
        st.write(pd.DataFrame(keyword_counts.items(), columns=["키워드", "횟수"]))
    else:
        st.warning("블로그 내용과 키워드를 입력하세요.")

