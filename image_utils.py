import requests
from PIL import Image, ImageDraw, ImageFont, ImageColor
from io import BytesIO
import os

# 블로그에서 이미지 URL 가져오기
def get_image_urls_from_blog(blog_url):
    response = requests.get(blog_url)
    if response.status_code == 200:
        html = response.text
        img_urls = []
        start_idx = 0
        while True:
            start_idx = html.find("<img", start_idx)
            if start_idx == -1:
                break
            start_idx = html.find('src="', start_idx) + 5
            end_idx = html.find('"', start_idx)
            img_url = html[start_idx:end_idx]
            img_urls.append(img_url)
            start_idx = end_idx
        return img_urls
    else:
        return []

# 메타데이터 제거하고 이미지 저장
def remove_metadata_and_save_image(img_url, save_path):
    response = requests.get(img_url)
    if response.status_code == 200:
        img = Image.open(BytesIO(response.content))
        img.save(save_path)
        return True
    return False

# 제목 이미지 생성
def create_title_image(text1, text2, text3):
    # 이미지 크기 설정
    width, height = 800, 800
    background_color = (73, 94, 87)  # 배경색 (짙은 하늘색)
    img = Image.new('RGB', (width, height), background_color)
    draw = ImageDraw.Draw(img)

    # 폰트 설정
    font_path = "NanumGothicCoding-Bold.ttf"  # 폰트 경로
    font_size = 80
    font = ImageFont.truetype(font_path, font_size)

    # 텍스트 색상 설정
    text_color1 = (244, 206, 20)  # 첫 번째 줄 색상
    text_color2 = (245, 247, 248)  # 두 번째 줄 색상
    text_color3 = (244, 206, 20)  # 세 번째 줄 색상

    # 줄 간격 조정
    line_spacing = 100  # 간격 조정

    # 전체 텍스트를 아래로 내리기 위한 Y 좌표 조정
    base_y = height // 3  # Y 좌표를 높여서 아래로 내림

    # 텍스트 박스 크기를 계산하고 가운데 정렬
    text1_bbox = draw.textbbox((0, 0), text1, font=font)
    draw.text(((width - (text1_bbox[2] - text1_bbox[0])) // 2, base_y - (text1_bbox[3] - text1_bbox[1]) // 2), text1, fill=text_color1, font=font)

    text2_bbox = draw.textbbox((0, 0), text2, font=font)
    draw.text(((width - (text2_bbox[2] - text2_bbox[0])) // 2, base_y + line_spacing - (text2_bbox[3] - text2_bbox[1]) // 2), text2, fill=text_color2, font=font)

    text3_bbox = draw.textbbox((0, 0), text3, font=font)
    draw.text(((width - (text3_bbox[2] - text3_bbox[0])) // 2, base_y + 2 * line_spacing - (text3_bbox[3] - text3_bbox[1]) // 2), text3, fill=text_color3, font=font)

    # 이미지 저장
    img_path = os.path.join('downloaded_images', "title_image.png")
    img.save(img_path)
    return img_path
