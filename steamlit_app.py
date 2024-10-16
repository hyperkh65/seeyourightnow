import streamlit as st
from image_utils import create_title_image, get_image_urls_from_blog, remove_metadata_and_save_image
import os

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
    </style>
    """, unsafe_allow_html=True)

# 페이지 제목
st.markdown('<div class="main-title">블로그 작성 도우미</div>', unsafe_allow_html=True)

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

# 이미지 다운로드 및 처리 버튼
if st.button('이미지 다운로드 및 메타데이터 제거'):
    image_paths = download_images_from_blog(blog_url)
    
    if title_text1 and title_text2 and title_text3:
        title_image_path = create_title_image(title_text1, title_text2, title_text3)  # 대표 이미지 생성
        image_paths.append(title_image_path)  # 대표 이미지 경로 추가
        st.image(title_image_path, caption="대표 이미지", use_column_width=True)

# 메인 실행 부분
if __name__ == "__main__":
    st.write("블로그 작성 도우미를 사용해 주셔서 감사합니다!")
