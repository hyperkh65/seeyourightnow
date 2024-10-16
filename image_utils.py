import os
from PIL import Image, ImageDraw, ImageFont, ImageColor

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

# 이미지 하단에 텍스트 추가 함수
def add_text_to_image(image_path, text):
    img = Image.open(image_path)
    draw = ImageDraw.Draw(img)

    # 폰트 설정
    font_path = "NanumGothicCoding-Bold.ttf"
    font_size = 40
    font = ImageFont.truetype(font_path, font_size)

    # 텍스트 색상
    text_color = (255, 255, 255)  # 흰색 텍스트

    # 하단 텍스트 박스 크기
    text_bbox = draw.textbbox((0, 0), text, font=font)
    draw.text(((img.width - (text_bbox[2] - text_bbox[0])) // 2, img.height - 60), text, fill=text_color, font=font)

    # 수정된 이미지 저장
    img.save(image_path)
