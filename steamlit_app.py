import streamlit as st
from image_utils import create_title_image, get_image_urls_from_blog, remove_metadata_and_save_image

def main():
    st.title("블로그 이미지 생성기")

    # 블로그 URL 입력
    blog_url = st.text_input("블로그 URL을 입력하세요:")

    if st.button("이미지 가져오기"):
        image_urls = get_image_urls_from_blog(blog_url)
        if image_urls:
            st.session_state.image_urls = image_urls
            st.success("이미지를 성공적으로 가져왔습니다!")
        else:
            st.error("이미지를 가져오는 데 실패했습니다.")

    # 가져온 이미지 표시
    if 'image_urls' in st.session_state:
        for img_url in st.session_state.image_urls:
            st.image(img_url, width=200)

    # 사용자 입력 텍스트
    text1 = st.text_input("텍스트 1")
    text2 = st.text_input("텍스트 2")
    text3 = st.text_input("텍스트 3")

    # 색상 선택
    bg_color = st.color_picker("배경 색상 선택", "#FFFFFF")
    text_color1 = st.color_picker("텍스트 1 색상 선택", "#000000")
    text_color2 = st.color_picker("텍스트 2 색상 선택", "#000000")
    text_color3 = st.color_picker("텍스트 3 색상 선택", "#000000")

    # 대표 이미지 생성 버튼
    if st.button("대표 이미지 생성"):
        img_path = create_title_image(text1, text2, text3, bg_color, text_color1, text_color2, text_color3)
        if img_path:
            st.image(img_path, caption="생성된 대표 이미지", use_column_width=True)
            st.success("이미지를 성공적으로 생성했습니다!")
        else:
            st.error("이미지 생성에 실패했습니다.")

    # 이미지에 텍스트 추가
    if st.button("텍스트 추가"):
        if 'image_urls' in st.session_state:
            for img_url in st.session_state.image_urls:
                img_path = remove_metadata_and_save_image(img_url, f"/mount/src/seeyourightnow/downloaded_images/{img_url.split('/')[-1]}")
                if img_path:
                    final_image_path = add_text_to_image(img_path, f"{text1} {text2} {text3}")
                    if final_image_path:
                        st.image(final_image_path, caption="텍스트가 추가된 이미지", use_column_width=True)
                    else:
                        st.error("텍스트 추가에 실패했습니다.")
                else:
                    st.error("이미지 다운로드에 실패했습니다.")

if __name__ == "__main__":
    main()
