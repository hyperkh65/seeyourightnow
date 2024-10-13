import streamlit as st
import requests
from bs4 import BeautifulSoup
from PIL import Image, ImageDraw, ImageFont
from io import BytesIO
import os
import re
import zipfile

# Streamlit 앱 설정
st.title('Tistory Image Downloader')
st.write('티스토리 블로그 본문에서 이미지를 다운로드하고 메타 데이터를 제거한 후 압축 파일로 제공합니다.')

# 유저가 입력할 티스토리 블로그 주소
blog_url = st.text_input('티스토리 블로그 주소를 입력하세요', '')
# 대표 이미지에 사용할 텍스트
title_text1 = st.text_input('대표 이미지 첫 번째 줄에 사용할 텍스트를 입력하세요', '')
title_text2 = st.text_input('대표 이미지 두 번째 줄에 사용할 텍스트를 입력하세요', '')
title_text3 = st.text_input('대표 이미지 세 번째 줄에 사용할 텍스트를 입력하세요', '')

# 이미지 저장 경로 (Streamlit은 일반적으로 임시 폴더 사용)
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
    draw.text(((width - (text3_bbox[2] - text3_bbox[0])) // 2, base_y + 2 * line_spacing - (text3_bbox[3] - text3_bbox[1]) // 2), text3, fill=text_color3, font=font)

    # 이미지 메모리에 저장
    img_buffer = BytesIO()
    img.save(img_buffer, format="PNG")
    img_buffer.seek(0)  # 버퍼의 시작으로 이동

    return img_buffer  # 메모리에서 이미지를 반환

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

# 사용자가 버튼을 클릭하면 이미지 다운로드 및 압축 파일 제공
if st.button('이미지 다운로드 및 메타데이터 제거'):
    image_paths = download_images_from_blog(blog_url)
    
    if title_text1 and title_text2 and title_text3:
        title_image_buffer = create_title_image(title_text1, title_text2, title_text3)  # 대표 이미지 생성
        st.image(title_image_buffer, caption="대표 이미지", use_column_width=True)  # 메모리에서 이미지 표시
    
    if image_paths:
        zip_file_path = create_zip_file(image_paths)
        with open(zip_file_path, "rb") as zip_file:
            st.download_button(
                label="이미지 압축 파일 다운로드",
                data=zip_file,
                file_name="images.zip",
                mime="application/zip"
            )
