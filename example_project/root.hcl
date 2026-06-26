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
    arguments = [
      "-out=${get_terragrunt_dir()}/${basename(path_relative_to_include())}.tfplan"
    ]
  }

  after_hook "plan_diff" {
    commands = ["plan"]
    execute  = ["bash", "-c", "terraform show -no-color ${get_terragrunt_dir()}/${basename(path_relative_to_include())}.tfplan > ${get_terragrunt_dir()}/${basename(path_relative_to_include())}.diff"]
  }
}
