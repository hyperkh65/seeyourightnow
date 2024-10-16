import streamlit as st
from image_utils import create_title_image, get_image_urls_from_blog, remove_metadata_and_save_image

# Streamlit 애플리케이션 제목
st.title("블로그 이미지 생성기")

# 블로그 주소 입력
blog_url = st.text_input("블로그 URL을 입력하세요:")

# 색상 선택기 추가
st.subheader("대표 이미지 색상 선택")
default_color = '#FF0000'  # 기본 색상 (빨강)
selected_color = st.color_picker("색상을 선택하세요", default_color)

# 텍스트 입력
text1 = st.text_input("텍스트 1:")
text2 = st.text_input("텍스트 2:")
text3 = st.text_input("텍스트 3:")

# 이미지 생성 버튼
if st.button("이미지 생성"):
    if blog_url and text1 and text2 and text3:
        try:
            # 대표 이미지 생성
            img_path = create_title_image(text1, text2, text3, selected_color)
            st.image(img_path, caption="생성된 대표 이미지", use_column_width=True)

            # 블로그 이미지 가져오기
            image_urls = get_image_urls_from_blog(blog_url)
            st.write("블로그에서 가져온 이미지 URLs:")
            for idx, image_url in enumerate(image_urls):
                st.write(image_url)
                img_path = remove_metadata_and_save_image(image_url, idx)
                st.image(img_path, caption=f"이미지 {idx + 1}", use_column_width=True)

        except Exception as e:
            st.error(f"오류가 발생했습니다: {e}")

