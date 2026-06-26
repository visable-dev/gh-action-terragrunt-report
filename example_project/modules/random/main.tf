terraform {
  required_providers {
    random = {
      source  = "hashicorp/random"
      version = "~> 3.7"
    }
  }
}


resource random_pet pet {
  length = var.random_length
}

resource random_password password {
  length  = var.random_length
  upper   = true
  lower   = true
  number  = true
  special = true
}

