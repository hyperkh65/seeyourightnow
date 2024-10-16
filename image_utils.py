import requests
from PIL import Image, ImageDraw, ImageFont  # ImageDraw와 ImageFont 추가
from io import BytesIO
import os
import re
from bs4 import BeautifulSoup  # BeautifulSoup import 추가

def create_title_image(text1, text2, text3, bg_color, text_color1, text_color2, text_color3):
    width, height = 800, 800
    background_color = ImageColor.getrgb(bg_color)  # 배경색
    img = Image.new('RGB', (width, height), background_color)
    draw = ImageDraw.Draw(img)

    # 폰트 설정
    font_path = "NanumGothicCoding-Bold.ttf"  # 로컬에서 사용하는 폰트
    font_size = 100
    font = ImageFont.truetype(font_path, font_size)

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

    img.save(os.path.join("downloaded_images", "title_image.png"))
    return os.path.join("downloaded_images", "title_image.png")



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
        raise Exception(f"페이지를 불러오는 중 오류가 발생했습니다: {e}")

def remove_metadata_and_save_image(image_url, idx):
    try:
        response = requests.get(image_url)
        img = Image.open(BytesIO(response.content))
        img_without_metadata = Image.new(img.mode, img.size)
        img_without_metadata.putdata(list(img.getdata()))
        
        file_extension = image_url.split('.')[-1].split('?')[0]
        safe_filename = re.sub(r'[^a-zA-Z0-9]', '_', image_url.split('/')[-1])
        image_filename = f"image_{idx+1}_{safe_filename[:10]}.{file_extension}"
        save_path = os.path.join("downloaded_images", image_filename)
        
        img_without_metadata.save(save_path, format=img.format)
        return save_path
    except Exception as e:
        raise Exception(f"이미지를 처리하는 중 오류 발생: {e}")
