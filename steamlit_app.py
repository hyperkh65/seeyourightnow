import streamlit as st

# Google Ads Script 데이터
ads_scripts = {
    "구라다 광고": '''<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-8940400388075870"
 crossorigin="anonymous"></script>
<!-- 구라다 -->
<ins class="adsbygoogle"
     style="display:block"
     data-ad-client="ca-pub-8940400388075870"
     data-ad-slot="5882156375"
     data-ad-format="auto"
     data-full-width-responsive="true"></ins>
<script>
     (adsbygoogle = window.adsbygoogle || []).push({});
</script>''',

    "블로그스팟 광고": '''<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-8940400388075870"
 crossorigin="anonymous"></script>
<!-- 블로그스팟 -->
<ins class="adsbygoogle"
     style="display:block"
     data-ad-client="ca-pub-8940400388075870"
     data-ad-slot="9804410890"
     data-ad-format="auto"
     data-full-width-responsive="true"></ins>
<script>
     (adsbygoogle = window.adsbygoogle || []).push({});
</script>''',

    "미라클E 광고": '''<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-8940400388075870"
 crossorigin="anonymous"></script>
<!-- 미라클E -->
<ins class="adsbygoogle"
     style="display:block"
     data-ad-client="ca-pub-8940400388075870"
     data-ad-slot="7074519437"
     data-ad-format="auto"
     data-full-width-responsive="true"></ins>
<script>
     (adsbygoogle = window.adsbygoogle || []).push({});
</script>'''
}

# Streamlit 레이아웃 설정 (전체 화면 사용)
st.set_page_config(layout="wide")

st.title('블로그 작성 도우미 및 Google Ads 스크립트 제공')

# 블로그 글 작성란
input_text = st.text_area("블로그 글을 작성하세요", height=300).strip()

# 광고 스크립트 복사 버튼들
st.subheader("Google 광고 스크립트 복사")
for ad_name, ad_script in ads_scripts.items():
    st.code(ad_script, language="html")
    st.markdown(f'<button class="copy-button" onclick="copyToClipboard(`{ad_script}`)">📋 {ad_name} 스크립트 복사</button>', unsafe_allow_html=True)

# JavaScript를 사용하여 클립보드 복사 기능 구현
copy_js = """
<script>
    function copyToClipboard(text) {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
        alert("광고 스크립트가 클립보드에 복사되었습니다!");
    }
</script>
"""
st.markdown(copy_js, unsafe_allow_html=True)

# 이모티콘 삽입 및 글자 수 계산
emoji_map = {
    "행복": "😊", "슬픔": "😢", "화남": "😡", "사랑": "😍", "생각": "🤔", "웃음": "😂", "울음": "😭", "장난": "😜", "멋짐": "😎",
    "축하": "🎉", "성공": "🏆", "1등": "🥇", "박수": "👏", "별": "🌟", "파티": "🥳",
    "음식": "🍽", "커피": "☕", "맥주": "🍺", "집": "🏠", "잠": "🛏", "자동차": "🚗"
}

st.subheader("이모티콘 자동 삽입")
if st.button('이모티콘 삽입'):
    for keyword, emoji in emoji_map.items():
        input_text = input_text.replace(keyword, f"{keyword} {emoji}")

st.write("이모티콘이 추가된 글:")
st.text_area("이모티콘이 추가된 블로그 글", input_text, height=300)

# 글자 수 계산 (공백 제외)
char_count = len(input_text.replace(" ", ""))
st.write(f"공백을 제외한 글자 수: {char_count}")

# 최종적으로 작성된 글과 이모티콘이 삽입된 내용을 사용할 수 있게 함
st.subheader("최종 글")
st.text_area("최종 블로그 글", input_text, height=300)
