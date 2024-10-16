from PIL import Image, ImageDraw, ImageFont
import requests
from bs4 import BeautifulSoup
import os

def get_image_urls_from_blog(blog_url):
    """블로그에서 이미지 URL을 가져옵니다."""
    try:
        response = requests.get(blog_url)
        soup = BeautifulSoup(response.text, 'html.parser')
        img_tags = soup.find_all('img')
        image_urls = [img['src'] for img in img_tags if 'src' in img.attrs]
        return image_urls
    except Exception as e:
        print(f"Error fetching images: {e}")
        return []

def create_title_image(text1, text2, text3, bg_color, text_color1, text_color2, text_color3):
    """대표 이미지를 생성합니다."""
    img = Image.new('RGB', (800, 400), bg_color)
    draw = ImageDraw.Draw(img)

    # 폰트 설정 (폰트 경로 및 크기를 조정해야 할 수 있습니다)
    font_path = "arial.ttf"  # 사용할 폰트 경로
    font_size = 30
    font1 = ImageFont.truetype(font_path, font_size)
    font2 = ImageFont.truetype(font_path, font_size)
    font3 = ImageFont.truetype(font_path, font_size)

    # 텍스트 위치 설정
    draw.text((50, 50), text1, fill=text_color1, font=font1)
    draw.text((50, 150), text2, fill=text_color2, font=font2)
    draw.text((50, 250), text3, fill=text_color3, font=font3)

    # 이미지 저장
    img_path = "generated_image.png"
    img.save(img_path)
    return img_path
