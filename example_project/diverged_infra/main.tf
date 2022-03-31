module random_1{
  count = 2
  source = "./../modules/random"
  random_length = 15
}

output "random_1" {
  value = module.random_1[0].pet
}

output "random_2" { # This output is not part of the state yet
  value = module.random_1[1].pet
}
