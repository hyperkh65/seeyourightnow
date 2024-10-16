import streamlit as st
import requests
import re
import os
import zipfile
from bs4 import BeautifulSoup
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

# 사이드바 설정
st.sidebar.header('옵션 설정')

# 블로그 주소 입력 (사이드바로 이동)
blog_url = st.sidebar.text_input('티스토리 블로그 주소를 입력하세요', '')

# 대표 이미지 텍스트 입력 (사이드바로 이동)
title_text1 = st.sidebar.text_input('대표 이미지 첫 번째 줄에 사용할 텍스트를 입력하세요', '')
title_text2 = st.sidebar.text_input('대표 이미지 두 번째 줄에 사용할 텍스트를 입력하세요', '')
title_text3 = st.sidebar.text_input('대표 이미지 세 번째 줄에 사용할 텍스트를 입력하세요', '')

# 반짝이는 버튼 만들기 (사이드바로 이동)
button_text = st.sidebar.text_input("버튼 텍스트 입력")
button_link = st.sidebar.text_input("버튼 링크 입력")

if st.sidebar.button("반짝이는 버튼 코드 생성"):
    button_code = f"""
    <a href="{button_link}" target="_blank">
        <button class="glow-on-hover" type="button">{button_text}</button>
    </a>
    """
    st.code(button_code, language='html')
    st.sidebar.success("반짝이는 버튼 코드가 생성되었습니다. 위의 코드를 복사하여 사용하세요.")
    st.markdown(button_code, unsafe_allow_html=True)

# 블로그 본문에서 링크를 추출하는 함수
def get_links_from_blog(url):
    try:
        response = requests.get(url)
        soup = BeautifulSoup(response.text, 'html.parser')
        links = []
        for a_tag in soup.find_all('a', href=True):
            link_text = a_tag.text.strip()
            link_url = a_tag['href']
            links.append((link_text, link_url))
        return links
    except Exception as e:
        st.error(f"링크를 불러오는 중 오류가 발생했습니다: {e}")
        return []

# 링크 추출 및 표시
st.markdown('<div class="section-title">블로그 본문에서 링크 추출</div>', unsafe_allow_html=True)
if st.button('링크 추출'):
    links = get_links_from_blog(blog_url)  # 사용자가 입력한 블로그 URL에서 링크 추출
    if links:
        st.write(f"총 {len(links)}개의 링크를 찾았습니다:")
        for idx, (link_text, link_url) in enumerate(links):
            col1, col2, col3 = st.columns([3, 6, 1])
            with col1:
                st.markdown(f"[{link_text}]({link_url})")  # 링크 텍스트
            with col2:
                st.markdown(f"({link_url})")  # 링크 주소
            with col3:
                # 각 버튼의 key를 고유하게 하기 위해 인덱스 사용
                if st.button("링크 복사", key=f"copy_{idx}"):
                    st.session_state.copied_link = link_url
                    st.success("링크가 복사되었습니다!")

    else:
        st.write("링크를 찾지 못했습니다.")

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
    draw.text(((width - (text3_bbox[2] - text3_bbox[0])) // 2, base_y + line_spacing * 2 - (text3_bbox[3] - text3_bbox[1]) // 2), text3, fill=text_color3, font=font)

    # 이미지 저장
    title_image_path = os.path.join(save_dir, 'title_image.png')
    img.save(title_image_path)
    return title_image_path

# 블로그에서 이미지 다운로드 및 메타데이터 제거
def download_images_from_blog(blog_url):
    img_urls = get_image_urls_from_blog(blog_url)
    if img_urls:
        image_paths = []
        for idx, img_url in enumerate(img_urls):
            img_path = remove_metadata_and_save_image(img_url, idx)
            if img_path:
                image_paths.append(img_path)
        return image_paths
    return []

# 이미지들을 압축하여 다운로드할 수 있도록 zip 파일 생성
def create_zip_file(image_paths):
    zip_filename = "images.zip"
    zip_filepath = os.path.join(save_dir, zip_filename)
    with zipfile.ZipFile(zip_filepath, 'w') as zip_file:
        for image_path in image_paths:
            zip_file.write(image_path, os.path.basename(image_path))
    return zip_filepath

# 사이드바에서 블로그 주소와 대표 이미지 텍스트를 입력받아 이미지를 다운로드하는 메인 프로세스
if st.sidebar.button('이미지 다운로드 및 메타데이터 제거'):
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
