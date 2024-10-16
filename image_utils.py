import streamlit as st
from image_utils import create_title_image, get_image_urls_from_blog, remove_metadata_and_save_image

def main():
    st.title("블로그 이미지 생성기")

    blog_url = st.text_input("블로그 URL 입력")
    
    if st.button("이미지 가져오기"):
        img_urls = get_image_urls_from_blog(blog_url)
        if img_urls:
            for idx, img_url in enumerate(img_urls):
                st.image(img_url, caption=f"이미지 {idx + 1}", use_column_width=True)
        else:
            st.error("이미지를 가져올 수 없습니다.")

    # 텍스트 입력 받기
    text1 = st.text_input("텍스트 1")
    text2 = st.text_input("텍스트 2")
    text3 = st.text_input("텍스트 3")

    # 색상 선택
    bg_color = st.color_picker("배경 색상 선택", "#FFFFFF")
    text_color1 = st.color_picker("텍스트 1 색상 선택", "#000000")
    text_color2 = st.color_picker("텍스트 2 색상 선택", "#000000")
    text_color3 = st.color_picker("텍스트 3 색상 선택", "#000000")

    if st.button("대표 이미지 생성"):
        img_path = create_title_image(text1, text2, text3, bg_color, text_color1, text_color2, text_color3)
        st.image(img_path, caption="생성된 제목 이미지", use_column_width=True)

if __name__ == "__main__":
    main()
