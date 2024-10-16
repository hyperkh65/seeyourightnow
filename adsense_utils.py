import streamlit as st

def display_adsense_codes():
    st.markdown('<div class="section-title">구글 애드센스 코드</div>', unsafe_allow_html=True)

    adsense_codes = {
        "구라다": "<script async src='https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-8940400388075870' crossorigin='anonymous'></script>",
        "블로그스팟": "<script async src='https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-8940400388075870' crossorigin='anonymous'></script>",
        "미라클E": "<script async src='https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-8940400388075870' crossorigin='anonymous'></script>"
    }

    cols = st.columns(3)
    for i, (name, code) in enumerate(adsense_codes.items()):
        with cols[i]:
            if st.button(f"{name} 광고 코드 복사"):
                st.code(code, language='html')
                st.success(f"{name} 광고 코드가 표시되었습니다. 복사하여 사용하세요.")

def create_button():
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
