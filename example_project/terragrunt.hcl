remote_state {
  backend = "local"
  generate = {
    path      = "backend.generated.tf"
    if_exists = "overwrite_terragrunt"
  }
  config = {
    path = "${path_relative_from_include()}/states/${path_relative_to_include()}/terraform.tfstate"
  }
}

terraform {
  extra_arguments "plan-output" {
    commands = ["plan"]
    arguments = ["-out=${path_relative_from_include()}/${path_relative_to_include()}.tfplan"]
  }

  after_hook "plan_diff" {
    commands     = ["plan"]
    execute      = ["bash", "-c", "terraform show -no-color ${path_relative_from_include()}/${path_relative_to_include()}.tfplan > ${path_relative_from_include()}/${path_relative_to_include()}.diff"]
  }
}
