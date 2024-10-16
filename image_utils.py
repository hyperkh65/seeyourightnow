# image_utils.py

import os
import requests
from PIL import Image, ImageDraw, ImageFont, ImageColor
from io import BytesIO

def get_image_urls_from_blog(blog_url):
    # 블로그에서 이미지 URL을 가져오는 코드
    # (여기에 웹 스크래핑 관련 코드를 추가하세요)
    # 이미지 URL 리스트를 반환
    image_urls = []  # 예시, 실제 구현 필요
    return image_urls

def create_title_image(text1, text2, text3, bg_color, text_color1, text_color2, text_color3):
    # 이미지 크기 설정
    width = 800
    height = 400

    # 배경 이미지 생성
    img = Image.new('RGB', (width, height), bg_color)

    # Draw 객체 생성
    draw = ImageDraw.Draw(img)

    # 기본 폰트 설정
    font_size = 40
    font = ImageFont.load_default()

    # 텍스트 추가
    draw.text((50, 50), text1, fill=text_color1, font=font)
    draw.text((50, 150), text2, fill=text_color2, font=font)
    draw.text((50, 250), text3, fill=text_color3, font=font)

    # 이미지 저장
    img_path = '/mount/src/seeyourightnow/downloaded_images/title_image.png'
    img.save(img_path)

    return img_path

def add_text_to_image(image_path, text):
    # 기존 이미지 열기
    img = Image.open(image_path)
    
    # Draw 객체 생성
    draw = ImageDraw.Draw(img)

    # 텍스트 위치 및 폰트 설정
    text_position = (50, img.height - 100)  # 이미지 하단에 텍스트 추가
    font = ImageFont.load_default()

    # 텍스트 색상 설정 (기본값)
    text_color = (255, 255, 255)

    # 텍스트 추가
    draw.text(text_position, text, fill=text_color, font=font)

    # 이미지 저장
    img.save(image_path)

    return image_path

def remove_metadata_and_save_image(image_url, save_path):
    # 이미지 다운로드 및 메타데이터 제거
    response = requests.get(image_url)
    img = Image.open(BytesIO(response.content))
    
    # 메타데이터 제거 (PIL에서 제공하는 기능 없음)
    img.save(save_path)
    
    return save_path
