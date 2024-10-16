import streamlit as st

def manage_links():
    st.markdown('<div class="section-title">링크 관리</div>', unsafe_allow_html=True)
    links = st.text_area("링크를 입력하세요 (각 링크는 새 줄로 구분)", "")
    if st.button("링크 목록 생성"):
        if links:
            link_list = links.split("\n")
            for link in link_list:
                link_name, link_url = link.split(",") if "," in link else (link, "#")
                st.write(f"[{link_name.strip()}]({link_url.strip()})")
                if st.button(f"링크 복사: {link_name.strip()}", key=link_name):
                    st.success(f"{link_name.strip()} 링크가 복사되었습니다.")
        else:
            st.warning("링크를 입력하세요.")
