import streamlit as st
from image_utils import create_title_image, get_image_urls_from_blog, remove_metadata_and_save_image
from link_utils import manage_links
from adsense_utils import display_adsense_codes, create_button

# 페이지 레이아웃 설정
st.set_page_config(layout="wide", page_title="블로그 작성 도우미")

# 사용자 정의 CSS 추가
def add_custom_css():
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
        @keyframes glowing {
            0% { background-position: 0 0; }
            50% { background-position: 400% 0; }
            100% { background-position: 0 0; }
        }
        </style>
    """, unsafe_allow_html=True)

add_custom_css()

st.title("블로그 작성 도우미")
st.markdown("원하는 기능을 선택하세요.")

# 기능 선택 버튼
selected_function = st.selectbox("기능 선택", ["제목 이미지 생성", "링크 관리", "구글 애드센스 코드", "반짝이는 버튼 생성"])

if selected_function == "제목 이미지 생성":
    st.subheader("제목 이미지 생성")
    text1 = st.text_input("첫 번째 텍스트")
    text2 = st.text_input("두 번째 텍스트")
    text3 = st.text_input("세 번째 텍스트")

    if st.button("이미지 생성"):
        if text1 and text2 and text3:
            img_path = create_title_image(text1, text2, text3)
            st.image(img_path)
            st.success("이미지가 생성되었습니다.")
        else:
            st.warning("모든 텍스트를 입력하세요.")

elif selected_function == "링크 관리":
    manage_links()

elif selected_function == "구글 애드센스 코드":
    display_adsense_codes()

elif selected_function == "반짝이는 버튼 생성":
    create_button()
