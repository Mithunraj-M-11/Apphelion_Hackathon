from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+psycopg://aphelion:aphelion_dev@localhost:5432/aphelion"
    # Where uploaded files (optional truck photos) are stored; a persistent volume in compose.
    upload_dir: str = "/app/data/uploads"
    # Identify rules: "strict" = plate + FASTag + radar length must all be present and agree.
    identify_mode: str = "strict"


settings = Settings()
